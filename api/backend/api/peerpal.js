export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                error: "Message is required"
            });
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: `You are PeerPal, an advanced AI academic assistant built into PeerLoom.

Your role:
- Help university students and lecturers
- Explain concepts clearly
- Assist with assignments, discussions, research, productivity, and educational growth
- Be intelligent, accurate, conversational, and supportive
- Answer both simple and advanced questions
- Give detailed explanations when necessary
- Keep responses natural, engaging, and helpful
- Avoid robotic replies
- Break down difficult concepts step-by-step when useful
- Support:
  * academics
  * productivity
  * motivation
  * collaboration
  * general knowledge
- Always prioritize usefulness, clarity, and educational value

User question:
${message}`
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 2048
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API HTTP Error:", errorText);

            return res.status(response.status).json({
                reply: "PeerPal is currently unavailable."
            });
        }

        const data = await response.json();

        const aiReply =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            "PeerPal is currently unavailable.";

        return res.status(200).json({
            reply: aiReply
        });

    } catch (error) {
        console.error("PeerPal Backend Error:", error);

        return res.status(500).json({
            reply: "PeerPal is currently unavailable."
        });
    }
}
