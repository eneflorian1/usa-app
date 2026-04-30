const mongoose = require('mongoose');

// ===================== MONGOOSE MODEL =====================

const paymentTransactionSchema = new mongoose.Schema({
    url: { type: String, required: true },
    task: { type: String, default: '' },
    network: { type: String, default: 'base-sepolia' },
    amountUSDC: { type: String, default: '0' },
    txHash: { type: String, default: '' },
    status: { type: String, enum: ['success', 'failed', 'skipped'], default: 'success' },
    error: { type: String, default: '' },
    responseData: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

let PaymentTransaction;
try {
    PaymentTransaction = mongoose.model('PaymentTransaction');
} catch {
    PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
}

// ===================== WALLET HELPERS =====================

async function getWalletConfig() {
    const { getApiKey } = require('./configService');
    let privateKey = null, network = 'base-sepolia';
    try { privateKey = await getApiKey('wallet_private_key'); } catch {}
    try { network = await getApiKey('wallet_network'); } catch {}
    return { privateKey, network };
}

async function getWalletBalance() {
    const { privateKey, network } = await getWalletConfig();

    if (!privateKey) {
        return { configured: false, balance: '0.00', address: null, network };
    }

    try {
        const { createWalletClient, createPublicClient, http, formatUnits } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');
        const { base, baseSepolia } = await import('viem/chains');

        const chain = network === 'base' ? base : baseSepolia;
        const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
        const account = privateKeyToAccount(pk);

        // USDC contract addresses
        const USDC_ADDRESS = network === 'base'
            ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
            : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

        const publicClient = createPublicClient({
            chain,
            transport: http()
        });

        // ERC-20 balanceOf ABI
        const balanceRaw = await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: [{
                name: 'balanceOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: '', type: 'uint256' }]
            }],
            functionName: 'balanceOf',
            args: [account.address]
        });

        const balance = formatUnits(balanceRaw, 6); // USDC is 6 decimals

        return {
            configured: true,
            balance,
            address: account.address,
            network
        };
    } catch (err) {
        console.error('[x402] getWalletBalance error:', err.message);
        return { configured: true, balance: 'error', address: null, network, error: err.message };
    }
}

// ===================== MAIN PAYMENT FUNCTION =====================

async function executePayment(url, task = '', maxAmountUSDC = 0.01) {
    const { privateKey, network } = await getWalletConfig();

    if (!privateKey) {
        const rec = await PaymentTransaction.create({
            url, task, network,
            amountUSDC: '0',
            status: 'failed',
            error: 'Wallet private key not configured. Set it in /payments settings.'
        });
        return {
            success: false,
            error: 'Wallet not configured',
            transactionId: rec._id
        };
    }

    try {
        // Dynamic ESM imports (x402-fetch is ESM-only)
        const { wrapFetchWithPayment } = await import('x402-fetch');
        const { privateKeyToAccount } = await import('viem/accounts');
        const { base, baseSepolia } = await import('viem/chains');

        const chain = network === 'base' ? base : baseSepolia;
        const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
        const account = privateKeyToAccount(pk);

        // Create payment-enabled fetch
        const fetchWithPayment = wrapFetchWithPayment(fetch, account, {
            maxAmountRequired: BigInt(Math.round(maxAmountUSDC * 1_000_000)), // convert to USDC units (6 decimals)
        });

        console.log(`[x402] Attempting payment for: ${url} (max: $${maxAmountUSDC} USDC on ${network})`);

        const response = await fetchWithPayment(url);
        const responseText = await response.text();

        let amountPaid = '0';
        let txHash = '';

        // Try to extract payment info from response headers
        const paymentHeader = response.headers.get('x-payment-response');
        if (paymentHeader) {
            try {
                const payInfo = JSON.parse(paymentHeader);
                amountPaid = payInfo.amount || '0';
                txHash = payInfo.transaction || '';
            } catch { }
        }

        const rec = await PaymentTransaction.create({
            url, task, network,
            amountUSDC: amountPaid,
            txHash,
            status: 'success',
            responseData: responseText.substring(0, 2000)
        });

        console.log(`[x402] Payment successful for: ${url} → tx: ${txHash}`);

        return {
            success: true,
            url,
            amountPaid,
            txHash,
            network,
            responseData: responseText.substring(0, 1000),
            transactionId: rec._id
        };

    } catch (err) {
        console.error('[x402] Payment error:', err.message);

        // If 402 but no payment configured/needed, record as skipped
        const status = err.message?.includes('402') ? 'skipped' : 'failed';

        const rec = await PaymentTransaction.create({
            url, task, network,
            amountUSDC: '0',
            status,
            error: err.message?.substring(0, 500)
        });

        return {
            success: false,
            error: err.message,
            transactionId: rec._id
        };
    }
}

// ===================== HISTORY =====================

async function getTransactionHistory(limit = 50) {
    return await PaymentTransaction.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
}

module.exports = {
    executePayment,
    getWalletBalance,
    getTransactionHistory,
    PaymentTransaction
};
