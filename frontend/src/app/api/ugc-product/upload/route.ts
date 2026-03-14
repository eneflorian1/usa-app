import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json(); // Next.js 13+ parses body here
        const { productId, endpoint, images } = body;

        const res = await fetch(`http://localhost:5000/api/ugc-product/${productId}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            return NextResponse.json({ error: errorText }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Next.js API proxy error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
