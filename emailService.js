const { google } = require('googleapis');

async function sendEmail(authClient, to, subject, body) {
    const gmail = google.gmail({ version: 'v1', auth: authClient });

    // Ensure body format is clean text (strip markdown if needed)
    const rawMessage = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        body.replace(/\n/g, '<br>')
    ].join('\n');

    // Encode message in base64url format required by Gmail API
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log('Email sent successfully:', res.data);
        return true;
    } catch (error) {
        console.error('Failed to send email:', error);
        throw error;
    }
}

module.exports = { sendEmail };
