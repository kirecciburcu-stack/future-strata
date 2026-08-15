// Vercel serverless function
// Env vars required (set in Vercel dashboard -> Project -> Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  — your Anthropic Console API key
//   RESEND_API_KEY     — your Resend API key
//   RESEND_FROM        — the "from" address Resend is allowed to send as
//                        (e.g. "Future Strata <onboarding@resend.dev>" for testing,
//                         or an address on a domain you've verified in Resend for real use)

const FRAMEWORK = `
Referans çerçeve (bu yazarların kavramlarını organik biçimde, en uygun 1-2 tanesini öne çıkararak kullan; hepsini zorla sıkıştırma):
- Gaston Bachelard: ev, mahremiyet, kişisel mekân, hafıza
- Marc Augé: yer, yer-olmayan, geçicilik, anonimlik
- Erich Fromm: aidiyet, köklenme, bağ kurma, güvenlik ihtiyacı
- Ernest Becker: ölümlülük, varoluşsal güvenlik, anlam üretimi
- Anna Tsing: belirsizlik, kırılganlık, tutunma, birlikte var olma
- Mark Dion: sınıflandırma, koleksiyon, arşivleme, nesneler üzerinden anlam üretme (metodolojik referans; doğrudan "aidiyet teorisyeni" olarak değil)
`;

const SYSTEM_PROMPT_TR = `Sen bir sanat sergisi için katılımcı yanıtlarını okuyup kısa, düşünceli bir "sığınak analizi" yazan bir metin uzmanısın.
${FRAMEWORK}
Katılımcının hem seçmeli hem açık uçlu yanıtlarını birlikte oku, somut detaylara (verdiği örneklere, kelime seçimlerine) atıfta bulunarak bir örüntü kur.

Çıktıyı SADECE şu JSON formatında ver, başka hiçbir şey ekleme:
{
  "title": "Sığınak Tipi: [kısa, yaratıcı bir isim]",
  "body": "Analiz:\\n[2-3 paragraflık, katılımcının somut yanıtlarına atıfta bulunan, en uygun 1-2 yazarı organik şekilde ismiyle anan bir analiz]\\n\\nKısa Okuma\\nGüvenlik kaynağı: [...]\\nAidiyet kaynağı: [...]\\nBaşa çıkma biçimi: [...]\\nSığınak nesnesi: [...]\\nÇekirdek kavram: [...]"
}`;

const SYSTEM_PROMPT_EN = `You are a text specialist writing short, thoughtful "shelter analyses" of participant responses for an art exhibition.
Reference framework (use 1-2 of these organically, whichever fits best; don't force all of them in):
- Gaston Bachelard: home, intimacy, personal space, memory
- Marc Augé: place, non-place, transience, anonymity
- Erich Fromm: belonging, rootedness, bonding, need for security
- Ernest Becker: mortality, existential security, meaning-making
- Anna Tsing: uncertainty, fragility, holding on, co-existing
- Mark Dion: classification, collection, archiving, meaning through objects (methodological reference, not directly a "belonging theorist")

Read the participant's multiple-choice and open-ended answers together, referencing concrete details (their examples, word choices) to build a pattern.

Output ONLY this JSON format, nothing else:
{
  "title": "Shelter Type: [short, evocative name]",
  "body": "Analysis:\\n[2-3 paragraphs referencing the participant's concrete answers, naming 1-2 of the most fitting authors organically]\\n\\nQuick Read\\nSource of safety: [...]\\nSource of belonging: [...]\\nCoping style: [...]\\nShelter object: [...]\\nCore concept: [...]"
}`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { name, email, lang, answers } = req.body;

    if (!name || !email || !answers) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const isTr = lang !== 'en';
    const systemPrompt = isTr ? SYSTEM_PROMPT_TR : SYSTEM_PROMPT_EN;

    const answersText = Object.values(answers)
      .map(a => `${a.question}\n${a.answer || '—'}`)
      .join('\n\n');

    const userMessage = isTr
      ? `Katılımcı adı: ${name}\n\nYanıtlar:\n\n${answersText}`
      : `Participant name: ${name}\n\nAnswers:\n\n${answersText}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content.find(b => b.type === 'text')?.text || '{}';

    let analysis;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      // Fallback: if Claude didn't return clean JSON, use the raw text as the body
      analysis = { title: isTr ? 'Sığınak Analizi' : 'Shelter Analysis', body: rawText };
    }

    // Send the email via Resend (best-effort; don't fail the whole request if email fails)
    let emailSent = false;
    try {
      if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
        const emailHtml = `
          <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1b1712;">
            <p style="letter-spacing: 0.15em; text-transform: uppercase; font-size: 11px; color: #a9714b;">Future Strata — Exhibition Shelters</p>
            <h2 style="font-weight: 500;">${escapeHtml(analysis.title || '')}</h2>
            <p style="white-space: pre-wrap; line-height: 1.6; font-size: 15px;">${escapeHtml(analysis.body || '')}</p>
          </div>
        `;
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM,
            to: email,
            subject: isTr ? 'Sığınak Analizin — Future Strata' : 'Your Shelter Analysis — Future Strata',
            html: emailHtml
          })
        });
        emailSent = resendRes.ok;
        if (!resendRes.ok) {
          console.error('Resend error:', await resendRes.text());
        }
      }
    } catch (emailErr) {
      console.error('Email sending failed:', emailErr);
    }

    res.status(200).json({
      title: analysis.title,
      body: analysis.body,
      emailSent
    });
  } catch (err) {
    console.error('Analyze function error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
