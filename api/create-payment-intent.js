// api/create-payment-intent.js
// Place this file at: /api/create-payment-intent.js in your GitHub repository
//
// Add your Stripe SECRET key to Vercel Environment Variables:
// Name:  STRIPE_SECRET_KEY
// Value: sk_live_xxxxxxxxxxxxxxxx  (from Stripe Dashboard > Developers > API Keys)

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, currency } = req.body || {};

  // Validate inputs
  if (!amount || typeof amount !== 'number' || amount < 50) {
    return res.status(400).json({ error: 'Invalid amount.' });
  }

  if (!currency || typeof currency !== 'string') {
    return res.status(400).json({ error: 'Invalid currency.' });
  }

  // Enforce fixed price - never trust the client to set the amount
  // Change this if you change your price
  const FIXED_PRICE_CENTS = 999;
  const ALLOWED_CURRENCY  = 'aud';

  if (amount !== FIXED_PRICE_CENTS || currency.toLowerCase() !== ALLOWED_CURRENCY) {
    return res.status(400).json({ error: 'Invalid payment details.' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set in environment variables.');
    return res.status(500).json({ error: 'Payment service is not configured.' });
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount:   String(FIXED_PRICE_CENTS),
        currency: ALLOWED_CURRENCY,
        'automatic_payment_methods[enabled]': 'true',
        description: 'CVEZ Professional Resume Tailoring',
      }).toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Payment could not be initialised.'
      });
    }

    // Only return the client secret - never expose the full intent object
    return res.status(200).json({ clientSecret: data.client_secret });

  } catch (err) {
    console.error('PaymentIntent error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
}
