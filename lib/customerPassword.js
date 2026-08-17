const crypto = require('crypto');

/**
 * The throwaway Shopify password we hold per customer, so signing in does NOT rotate it.
 *
 * WHY THIS EXISTS. Shopify has no "log this user in, I vouch for them" primitive outside Multipass,
 * so an OTP login has to set a password and immediately trade it for an access token. Doing that on
 * every login rotates the password every time — and Shopify invalidates ALL existing customer access
 * tokens when a password changes. Measured: issue token A, issue token B, and A returns 401. In
 * practice that meant signing in on a phone silently signed you out on the laptop, and the frontend
 * turned the resulting 401 into a global logout. It also made cross-device cart pointless, since
 * only one device could hold a session at a time.
 *
 * So the password is generated once, kept, and reused. Rotation becomes the fallback for when we do
 * not have one (a customer created before this existed, a lost record, or Mongo being unreachable).
 *
 * STORED ENCRYPTED, not hashed: we have to present the plaintext to Shopify, so a one-way hash is
 * not an option. AES-256-GCM with a key from env, so a dump of the collection on its own is not
 * enough to mint tokens. It is still a credential — treat the key like the Shopify secrets.
 *
 * ponytail: no key rotation, no versioned envelopes. If CUSTOMER_PASSWORD_KEY ever changes, every
 * record simply fails to decrypt and each customer's password rotates once on their next login,
 * which is exactly the old behaviour and self-heals. That is a good enough migration story for a
 * secret that protects throwaway passwords.
 */
const ALGO = 'aes-256-gcm';
const COLLECTION = 'shopify_credentials';

const key = () => {
  const raw = process.env.CUSTOMER_PASSWORD_KEY;
  if (!raw) return null; // not configured -> caller falls back to rotating every login
  const buf = Buffer.from(raw, 'hex');
  return buf.length === 32 ? buf : crypto.createHash('sha256').update(raw).digest();
};

function encrypt(plain) {
  const k = key();
  if (!k) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join('.');
}

function decrypt(payload) {
  const k = key();
  if (!k || typeof payload !== 'string') return null;
  const [iv, tag, data] = payload.split('.');
  if (!iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGO, k, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, or tampered ciphertext. Treated as "no stored password", which rotates once.
    return null;
  }
}

// Shopify rejects a customer password over 40 characters; 16 bytes hex is 32.
const generate = () => crypto.randomBytes(16).toString('hex');

async function load(db, customerId) {
  if (!db || !key()) return null;
  const doc = await db.collection(COLLECTION).findOne({ customerId });
  return decrypt(doc?.password) || null;
}

async function save(db, customerId, password) {
  if (!db || !key()) return false;
  const encrypted = encrypt(password);
  if (!encrypted) return false;
  await db.collection(COLLECTION).updateOne(
    { customerId },
    { $set: { customerId, password: encrypted, updatedAt: new Date() } },
    { upsert: true },
  );
  return true;
}

module.exports = { load, save, generate, COLLECTION };
