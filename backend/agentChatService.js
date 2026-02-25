const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const BOOKING_SYSTEM_PROMPT = `Ești un agent de rezervări pentru o unitate de cazare. Vorbești în limba în care ești abordat.

REGULI DE REZERVARE:
- Check-in: între orele 12:00 și 23:59
- Check-out: între orele 08:00 și 11:00
- Trebuie să ceri OBLIGATORIU numele oaspetelui pentru rezervare
- Trebuie să ceri data de check-in și data de check-out

Când ai toate informațiile necesare (nume, data check-in cu ora, data check-out cu ora), răspunde cu un mesaj prietenos de confirmare și ADAUGĂ la sfârșitul mesajului un bloc JSON între tagurile <BOOKING_JSON> și </BOOKING_JSON>.

Formatul JSON:
<BOOKING_JSON>{"guestName":"Numele Oaspete","checkIn":"2026-02-28T14:00:00","checkOut":"2026-03-01T10:00:00"}</BOOKING_JSON>

IMPORTANT:
- Dacă utilizatorul nu specifică ora de check-in, folosește 14:00
- Dacă utilizatorul nu specifică ora de check-out, folosește 10:00
- Datele trebuie să fie în format ISO (YYYY-MM-DDTHH:mm:ss)
- NU include blocul JSON decât atunci când ai TOATE informațiile și ești gata să faci rezervarea
- Dacă ți se spune că intervalul e ocupat, sugerează alternative
- Poți purta conversații normale, nu doar despre rezervări
- Fii prietenos și profesional`;

async function getGeminiModel(systemInstruction) {
    const Setting = mongoose.model('Setting');
    const setting = await Setting.findOne({ key: 'gemini_api_key' });

    if (!setting || !setting.value) {
        throw new Error('Gemini API key not configured. Please set it in Settings.');
    }

    const genAI = new GoogleGenerativeAI(setting.value);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemInstruction
    });
}

function extractBookingJSON(text) {
    const match = text.match(/<BOOKING_JSON>([\s\S]*?)<\/BOOKING_JSON>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch (e) {
        console.error('Failed to parse booking JSON:', e);
        return null;
    }
}

function cleanResponseText(text) {
    return text.replace(/<BOOKING_JSON>[\s\S]*?<\/BOOKING_JSON>/g, '').trim();
}

async function processAgentMessage(userMessage, sessionId = 'default') {
    const AgentChat = mongoose.model('AgentChat');
    const Booking = mongoose.model('Booking');

    // Get or create chat session
    let chat = await AgentChat.findOne({ sessionId });
    if (!chat) {
        chat = await AgentChat.create({ sessionId, messages: [] });
    }

    // Build history for Gemini
    const recentMessages = chat.messages.slice(-30);
    const history = recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    const model = await getGeminiModel(BOOKING_SYSTEM_PROMPT);
    const geminiChat = model.startChat({ history });

    const result = await geminiChat.sendMessage(userMessage);
    const rawResponse = result.response.text();

    // Check if response contains a booking command
    const bookingData = extractBookingJSON(rawResponse);
    const responseText = cleanResponseText(rawResponse);
    let bookingResult = null;

    if (bookingData) {
        try {
            const ciDate = new Date(bookingData.checkIn);
            const coDate = new Date(bookingData.checkOut);

            // Validate check-in hour
            const ciHour = ciDate.getHours();
            if (ciHour < 12) {
                bookingResult = { success: false, error: 'Check-in must be between 12:00 and 24:00' };
            }
            // Validate check-out hour
            else {
                const coHour = coDate.getHours();
                if (coHour < 8 || coHour > 11) {
                    bookingResult = { success: false, error: 'Check-out must be between 08:00 and 11:00' };
                } else {
                    // Check overlap
                    const overlap = await Booking.findOne({
                        checkIn: { $lt: coDate },
                        checkOut: { $gt: ciDate }
                    });

                    if (overlap) {
                        bookingResult = {
                            success: false,
                            error: `Interval ocupat. Există deja o rezervare pe numele "${overlap.guestName}" (${overlap.checkIn.toLocaleDateString()} - ${overlap.checkOut.toLocaleDateString()}).`
                        };
                    } else {
                        const newBooking = await Booking.create({
                            guestName: bookingData.guestName,
                            checkIn: ciDate,
                            checkOut: coDate
                        });
                        bookingResult = { success: true, booking: newBooking };
                    }
                }
            }
        } catch (err) {
            bookingResult = { success: false, error: err.message };
        }
    }

    // Save messages to history
    chat.messages.push({ role: 'user', content: userMessage });

    // If booking failed, append error info so the AI knows in future messages
    let savedModelContent = responseText;
    if (bookingResult && !bookingResult.success) {
        savedModelContent += `\n[SYSTEM: Rezervarea a eșuat: ${bookingResult.error}]`;
    } else if (bookingResult && bookingResult.success) {
        savedModelContent += `\n[SYSTEM: Rezervarea a fost creată cu succes - ID: ${bookingResult.booking._id}]`;
    }

    chat.messages.push({ role: 'model', content: savedModelContent });
    chat.updatedAt = Date.now();
    await chat.save();

    return {
        reply: responseText,
        booking: bookingResult
    };
}

module.exports = { processAgentMessage };
