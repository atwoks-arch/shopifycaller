const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const {
  initializeApp,
  cert,
  getApps
} = require('firebase-admin/app');

const {
  getFirestore,
  FieldValue
} = require('firebase-admin/firestore');

const app = express();

const allowedOrigins = String(process.env.FRONTEND_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
if (allowedOrigins.length) {
  app.use(cors({ origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS.'));
  }}));
} else {
  console.warn('WARNING: FRONTEND_ORIGINS is unset; CORS allows all origins.');
  app.use(cors());
}
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));

// Deployment diagnostic: open /api/health to confirm which backend build is live.
const ATWOK_API_BUILD = 'atwok-shopify-integration-2026-11-28-v1';
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'ATWOK Backend',
    build: ATWOK_API_BUILD,
    trackingWhatsAppRoute: 'POST /api/whatsapp/tracking/send'
  });
});

// ============================================================
// FIREBASE
// ============================================================

const serviceAccount = require('./serviceAccountKey.json');

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

// ============================================================
// FIREBASE ORDER UPSERT
// ============================================================

async function saveOrUpdateOrder(newOrder) {
  const ordersRef = db.collection('orders');

  const snapshot = await ordersRef
    .where('shopifyOrderId', '==', newOrder.shopifyOrderId)
    .get();

  if (!snapshot.empty) {
    const existingDoc = snapshot.docs[0];
    const existingDocId = existingDoc.id;
    const existingOrder = existingDoc.data() || {};
    const hasManualEdits = Boolean(existingOrder.updatedAt);

    // IMPORTANT:
    // Don't overwrite the existing indiaPost object.
    // Preserve manual edits if the order was already edited in Label Studio.
    await ordersRef.doc(existingDocId).update({
      customerName: hasManualEdits ? existingOrder.customerName : newOrder.customerName,
      phone: hasManualEdits ? existingOrder.phone : newOrder.phone,
      address: hasManualEdits ? existingOrder.address : newOrder.address,
      receiverAddress1: hasManualEdits ? existingOrder.receiverAddress1 : (newOrder.receiverAddress1 || ''),
      receiverAddress2: hasManualEdits ? existingOrder.receiverAddress2 : (newOrder.receiverAddress2 || ''),
      receiverCity: hasManualEdits ? existingOrder.receiverCity : (newOrder.receiverCity || ''),
      receiverState: hasManualEdits ? existingOrder.receiverState : (newOrder.receiverState || ''),
      receiverPincode: hasManualEdits ? existingOrder.receiverPincode : (newOrder.receiverPincode || ''),
      product: hasManualEdits ? existingOrder.product : newOrder.product,
      lineItems: hasManualEdits && Array.isArray(existingOrder.lineItems) && existingOrder.lineItems.length
        ? existingOrder.lineItems
        : (newOrder.lineItems || []),
      amount: newOrder.amount,
      paymentMode: hasManualEdits ? existingOrder.paymentMode : newOrder.paymentMode,
      createdAt: existingOrder.createdAt || newOrder.createdAt,
      status: existingOrder.status || newOrder.status,
      remarks: existingOrder.remarks || newOrder.remarks,
      shopifyGid: newOrder.shopifyGid || existingOrder.shopifyGid || '',
      shopifyUpdatedAt: newOrder.shopifyUpdatedAt || existingOrder.shopifyUpdatedAt || '',
      currency: newOrder.currency || existingOrder.currency || 'INR',
      financialStatus: newOrder.financialStatus || existingOrder.financialStatus || '',
      fulfillmentStatus: newOrder.fulfillmentStatus || existingOrder.fulfillmentStatus || ''
    });

    console.log(
      `🔄 Duplicate Guard: Updated existing record for ${newOrder.shopifyOrderId}`
    );

    return {
      success: true,
      status: 'updated'
    };
  }

  await ordersRef.add(newOrder);

  console.log(
    `⚡ Duplicate Guard: Created new entry for ${newOrder.shopifyOrderId}`
  );

  return {
    success: true,
    status: 'created'
  };
}

// ============================================================
// HEALTH / MANUAL SYNC ROUTE
// ============================================================

app.get('/api/sync-last-order', (req, res) => {
  console.log('🔄 Manual Sync Ping Received from Frontend!');

  return res.status(200).json({
    success: true,
    message: 'Backend awake and listening for orders!'
  });
});

// ============================================================
// SHOPIFY WEBHOOK
// ============================================================
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';

function verifyShopifyWebhook(req) {
  const supplied = String(req.get('x-shopify-hmac-sha256') || '').trim();
  if (!SHOPIFY_WEBHOOK_SECRET || !req.rawBody || !supplied) return false;
  const expected = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(req.rawBody).digest('base64');
  return safeStringEqual(supplied, expected);
}

function getShopifyPaymentMode(order) {
  const financial = String(order.financial_status || '').toLowerCase();
  const gatewayText = [
    ...(Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names : []),
    order.gateway, order.processing_method
  ].filter(Boolean).join(' ').toLowerCase();
  if (financial === 'paid' || financial === 'partially_paid') return 'Prepaid';
  if (/cash on delivery|\bcod\b|collect on delivery/.test(gatewayText)) return 'COD';
  if (['pending', 'authorized', 'unpaid'].includes(financial)) return 'Unpaid';
  return 'Unknown';
}


app.post('/api/shopify-webhook', async (req, res) => {
  try {
    if (!SHOPIFY_WEBHOOK_SECRET) {
      console.error('SHOPIFY_WEBHOOK_SECRET is missing; webhook rejected.');
      return res.status(503).send('Webhook signing secret is not configured.');
    }
    if (!verifyShopifyWebhook(req)) {
      console.warn('Rejected Shopify webhook with invalid HMAC.');
      return res.status(401).send('Invalid Shopify webhook signature.');
    }
    const order = req.body || {};

    // ======================================================
    // SHIPPING ADDRESS
    // ======================================================

    const shipping =
      order.shipping_address ||
      order.billing_address ||
      {};

    const addressParts = [
      shipping.address1,
      shipping.address2,
      shipping.city,
      shipping.province,
      shipping.zip
    ].filter(Boolean);

    const fullAddress = addressParts.join(', ');

    // ======================================================
    // PRODUCT
    // ======================================================

    const lineItems = (Array.isArray(order.line_items) ? order.line_items : []).map(item => ({
      id: item.id || null,
      title: item.title || item.name || item.sku || 'Shopify Item',
      variantTitle: item.variant_title || '',
      quantity: Math.max(1, Number(item.quantity || 1)),
      price: Number(item.price || 0),
      sku: item.sku || ''
    }));

    const productTitle = lineItems.length
      ? lineItems
          .map(item => `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ''} × ${item.quantity}`)
          .join(', ')
      : 'Shopify Item';

    // ======================================================
    // PHONE
    // ======================================================

    const mainPhone =
      shipping.phone ||
      order.phone ||
      order.billing_address?.phone ||
      '';

    let extraPhone = '';

    if (Array.isArray(order.note_attributes) && order.note_attributes.length > 0) {
      const extraPhoneAttribute = order.note_attributes.find(attr => {
        const name = String(attr.name || '').toLowerCase();
        return (
          name.includes('phone') ||
          name.includes('mobile') ||
          name.includes('extra')
        );
      });

      if (extraPhoneAttribute) {
        extraPhone = extraPhoneAttribute.value;
      }
    }

    let displayPhone = mainPhone;

    if (extraPhone && extraPhone !== mainPhone) {
      displayPhone = `${mainPhone} / ${extraPhone}`;
    }

    // ======================================================
    // PAYMENT MODE & CUSTOMER
    // ======================================================

    const paymentMode = getShopifyPaymentMode(order);
    const exactShopifyTime = order.created_at || new Date().toISOString();

    const customerName =
      `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() ||
      order.customer?.first_name ||
      'Guest Customer';

    // ======================================================
    // FIREBASE ORDER
    // ======================================================

    const newOrder = {
      shopifyOrderId: order.name || `#${order.order_number}`,
      shopifyGid: order.admin_graphql_api_id || '',
      shopifyUpdatedAt: order.updated_at || '',
      customerName,
      phone: displayPhone,
      address: fullAddress,
      receiverAddress1: shipping.address1 || '',
      receiverAddress2: shipping.address2 || '',
      receiverCity: shipping.city || '',
      receiverState: shipping.province || '',
      receiverPincode: shipping.zip || '',
      email: order.email || order.customer?.email || '',
      product: productTitle,
      lineItems,
      quantity: lineItems[0]?.quantity || 1,
      amount: String(order.total_price || '0'),
      paymentMode,
      createdAt: exactShopifyTime,
      status: 'Pending',
      remarks: '',
      indiaPost: {
        status: 'NOT_BOOKED',
        articleNumber: '',
        barcode: '',
        bookingReference: '',
        batchId: '',
        mailBookingDomId: null,
        correlationId: '',
        calculatedTariff: null,
        currency: 'INR',
        bookedAt: null,
        errorMessage: ''
      }
    };

    await saveOrUpdateOrder(newOrder);

    console.log(`⚡ Shopify Webhook Success: ${newOrder.shopifyOrderId}`);

    return res.status(200).send('Webhook Processed Successfully');
  } catch (error) {
    console.error('❌ Shopify webhook error:', error);
    return res.status(500).send('Webhook Handler Failed');
  }
});

// ============================================================
// WHATSAPP CRM CONFIGURATION
// ============================================================

const WACRM_API_BASE_URL = 'https://api-whatsapp.wacrmpro.in';
const WACRM_API_TOKEN = process.env.WACRM_API_TOKEN || '';
const WACRM_TEST_API_KEY = process.env.WACRM_TEST_API_KEY || '';

function normalizeWhatsAppPhone(phone) {
  const firstPhone = String(phone || '').split(/[\/,;|]+/)[0].trim();
  let value = firstPhone.replace(/\D/g, '');

  if (value.length === 10) {
    value = `91${value}`;
  }

  if (value.length < 11 || value.length > 15) {
    throw new Error('Invalid phone number.');
  }

  return value;
}

// ============================================================
// WHATSAPP TEST MESSAGE API
// ============================================================

app.post('/api/whatsapp/test', async (req, res) => {
  try {
    if (!WACRM_TEST_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Test API key is missing.'
      });
    }

    if (req.get('x-atwok-test-key') !== WACRM_TEST_API_KEY) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized request.'
      });
    }

    if (!WACRM_API_TOKEN) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp CRM token is missing.'
      });
    }

    const { phone, message } = req.body || {};

    if (!phone || !message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone and message are required.'
      });
    }

    const response = await axios.post(
      `${WACRM_API_BASE_URL}/api/enviar-texto/${encodeURIComponent(WACRM_API_TOKEN)}`,
      {
        phone: normalizeWhatsAppPhone(phone),
        message: String(message).trim()
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 30000
      }
    );

    if (response.data?.success !== true) {
      return res.status(502).json({
        success: false,
        message: response.data?.message || 'WhatsApp sending failed.'
      });
    }

    return res.json({
      success: true,
      message: 'WhatsApp message sent successfully.'
    });
  } catch (error) {
    console.error(
      'WhatsApp CRM Error:',
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 502).json({
      success: false,
      message:
        error.response?.data?.message ||
        'Unable to send WhatsApp message.'
    });
  }
});

// ============================================================
// WHATSAPP HUB — SECURE LOGIN, ORDER LOOKUP & BACKGROUND BULK SEND
// ============================================================

const ATWOK_HUB_LOGIN_CODE = process.env.ATWOK_HUB_LOGIN_CODE || '';
const ATWOK_HUB_SESSION_SECRET = process.env.ATWOK_HUB_SESSION_SECRET || '';

function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createWhatsAppHubSession() {
  const payload = Buffer.from(JSON.stringify({
    scope: 'whatsapp-hub',
    exp: Date.now() + (8 * 60 * 60 * 1000)
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', ATWOK_HUB_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verifyWhatsAppHubSession(token) {
  if (!ATWOK_HUB_SESSION_SECRET || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;

  const [payload, suppliedSignature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', ATWOK_HUB_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  if (!safeStringEqual(suppliedSignature, expectedSignature)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.scope === 'whatsapp-hub' && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

const hubLoginAttempts = new Map();
const HUB_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const HUB_LOGIN_MAX_ATTEMPTS = 8;

app.post('/api/whatsapp/hub/login', (req, res) => {
  const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  let attempt = hubLoginAttempts.get(clientKey);
  if (!attempt || now - attempt.startedAt > HUB_LOGIN_WINDOW_MS) {
    attempt = { startedAt: now, count: 0 };
  }
  if (attempt.count >= HUB_LOGIN_MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((HUB_LOGIN_WINDOW_MS - (now - attempt.startedAt)) / 1000))));
    return res.status(429).json({ success: false, message: 'Too many login attempts. Please try again later.' });
  }
  attempt.count += 1;
  hubLoginAttempts.set(clientKey, attempt);
  if (hubLoginAttempts.size > 5000) {
    for (const [key, value] of hubLoginAttempts) {
      if (now - value.startedAt > HUB_LOGIN_WINDOW_MS) hubLoginAttempts.delete(key);
    }
  }
  if (!ATWOK_HUB_LOGIN_CODE || !ATWOK_HUB_SESSION_SECRET) {
    return res.status(503).json({ success: false, message: 'Secure login is not configured on the server.' });
  }

  const passcode = String(req.body?.passcode || '');
  if (!safeStringEqual(passcode, ATWOK_HUB_LOGIN_CODE)) {
    return res.status(401).json({ success: false, message: 'Incorrect access code.' });
  }

  return res.json({
    success: true,
    token: createWhatsAppHubSession(),
    expiresIn: 8 * 60 * 60
  });
});

function requireWhatsAppHubSession(req, res, next) {
  const authorization = String(req.get('authorization') || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!verifyWhatsAppHubSession(token)) {
    return res.status(401).json({ success: false, message: 'Your secure session has expired. Please log in again.' });
  }
  if (!WACRM_API_TOKEN) {
    return res.status(503).json({ success: false, message: 'WhatsApp CRM token is missing.' });
  }
  return next();
}


// ============================================================
// SHOPIFY ADMIN API — DEV DASHBOARD CLIENT CREDENTIALS
// Protected by the existing signed ATWOK Hub session.
// ============================================================

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOPIFY_SHOP = String(process.env.SHOPIFY_SHOP || 'atwok-store')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\.myshopify\.com\/?$/i, '')
  .replace(/\/+$/, '');
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

let shopifyTokenCache = {
  accessToken: '',
  expiresAt: 0,
  scopes: ''
};

function requireShopifyAdminSession(req, res, next) {
  const authorization = String(req.get('authorization') || '');
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!verifyWhatsAppHubSession(token)) {
    return res.status(401).json({
      success: false,
      message: 'Your secure session has expired. Please log in again.'
    });
  }

  return next();
}

function getShopifyConfigError() {
  if (!SHOPIFY_SHOP || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    return 'Shopify configuration is incomplete. Check SHOPIFY_SHOP, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Render.';
  }
  return '';
}

async function getShopifyAccessToken(forceRefresh = false) {
  const configError = getShopifyConfigError();
  if (configError) throw new Error(configError);

  // Refresh five minutes before Shopify's expires_in deadline.
  if (
    !forceRefresh &&
    shopifyTokenCache.accessToken &&
    Date.now() < shopifyTokenCache.expiresAt - 5 * 60 * 1000
  ) {
    return shopifyTokenCache.accessToken;
  }

  const tokenUrl = `https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`;
  const form = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });

  const response = await axios.post(tokenUrl, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });

  if (!response.data?.access_token) {
    throw new Error('Shopify did not return an Admin API access token.');
  }

  const expiresIn = Math.max(60, Number(response.data.expires_in || 86399));
  shopifyTokenCache = {
    accessToken: response.data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: String(response.data.scope || '')
  };

  console.log(`Shopify Admin API token acquired; expires in ${expiresIn} seconds.`);
  return shopifyTokenCache.accessToken;
}

async function shopifyGraphql(query, variables = {}, retryAuth = true) {
  const accessToken = await getShopifyAccessToken();
  const endpoint = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  try {
    const response = await axios.post(
      endpoint,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        timeout: 45000
      }
    );

    if (Array.isArray(response.data?.errors) && response.data.errors.length) {
      const messages = response.data.errors.map(item => item.message).filter(Boolean);
      throw new Error(messages.join('; ') || 'Shopify GraphQL request failed.');
    }

    return response.data?.data || {};
  } catch (error) {
    const status = error.response?.status;
    const shopifyMessage = error.response?.data?.errors?.[0]?.message;

    // If Shopify rejects a cached/expired token, obtain a fresh one once.
    if (status === 401 && retryAuth) {
      await getShopifyAccessToken(true);
      return shopifyGraphql(query, variables, false);
    }

    const message =
      shopifyMessage ||
      error.response?.data?.error ||
      error.message ||
      'Shopify Admin API request failed.';
    throw new Error(`Shopify API: ${message}`);
  }
}

function mapShopifyGraphqlOrderToAtwok(order) {
  const shipping = order.shippingAddress || {};
  const customer = order.customer || {};
  const graphLineItems = order.lineItems?.nodes || [];

  const lineItems = graphLineItems.map(item => ({
    id: item.id || null,
    title: item.title || item.name || item.sku || 'Shopify Item',
    variantTitle: item.variantTitle || '',
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: Number(item.originalUnitPriceSet?.shopMoney?.amount || 0),
    sku: item.sku || ''
  }));

  const productTitle = lineItems.length
    ? lineItems.map(item =>
        `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ''} × ${item.quantity}`
      ).join(', ')
    : 'Shopify Item';

  const gatewayNames = Array.isArray(order.paymentGatewayNames)
    ? order.paymentGatewayNames
    : [];

  const paymentMode = getShopifyPaymentMode({
    financial_status: String(order.displayFinancialStatus || '').toLowerCase(),
    payment_gateway_names: gatewayNames
  });

  const phone = shipping.phone || order.phone || customer.phone || '';
  const fullAddress = [
    shipping.address1,
    shipping.address2,
    shipping.city,
    shipping.province,
    shipping.zip
  ].filter(Boolean).join(', ');

  return {
    shopifyOrderId: order.name || `#${order.orderNumber}`,
    shopifyGid: order.id || '',
    shopifyUpdatedAt: order.updatedAt || '',
    customerName:
      `${shipping.firstName || customer.firstName || ''} ${shipping.lastName || customer.lastName || ''}`.trim() ||
      'Guest Customer',
    phone,
    address: fullAddress,
    receiverAddress1: shipping.address1 || '',
    receiverAddress2: shipping.address2 || '',
    receiverCity: shipping.city || '',
    receiverState: shipping.province || '',
    receiverPincode: shipping.zip || '',
    email: order.email || customer.email || '',
    product: productTitle,
    lineItems,
    quantity: lineItems[0]?.quantity || 1,
    amount: String(order.totalPriceSet?.shopMoney?.amount || '0'),
    currency: order.totalPriceSet?.shopMoney?.currencyCode || 'INR',
    paymentMode,
    financialStatus: order.displayFinancialStatus || '',
    fulfillmentStatus: order.displayFulfillmentStatus || '',
    createdAt: order.createdAt || new Date().toISOString(),
    status: 'Pending',
    remarks: '',
    indiaPost: {
      status: 'NOT_BOOKED',
      articleNumber: '',
      barcode: '',
      bookingReference: '',
      batchId: '',
      mailBookingDomId: null,
      correlationId: '',
      calculatedTariff: null,
      currency: 'INR',
      bookedAt: null,
      errorMessage: ''
    }
  };
}

const SHOPIFY_ORDERS_SYNC_QUERY = `
  query AtwokOrdersPage($after: String) {
    orders(first: 20, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          orderNumber
          createdAt
          updatedAt
          totalPriceSet { shopMoney { amount currencyCode } }
          displayFinancialStatus
          displayFulfillmentStatus
          paymentGatewayNames
          email
          phone
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            phone
          }
          customer { firstName lastName email phone }
          lineItems(first: 20) {
            nodes {
              id
              title
              name
              quantity
              sku
              variantTitle
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

app.get('/api/shopify/status', requireShopifyAdminSession, async (req, res) => {
  try {
    const token = await getShopifyAccessToken();
    return res.json({
      success: true,
      connected: Boolean(token),
      shop: `${SHOPIFY_SHOP}.myshopify.com`,
      apiVersion: SHOPIFY_API_VERSION,
      scopes: shopifyTokenCache.scopes,
      tokenExpiresAt: new Date(shopifyTokenCache.expiresAt).toISOString()
    });
  } catch (error) {
    console.error('Shopify status check failed:', error.message);
    return res.status(502).json({ success: false, message: error.message });
  }
});

// Imports up to 5 pages (100 orders) per request. Send nextCursor to continue.
// This keeps Render requests short and avoids trying to import a large store in one HTTP call.
app.post('/api/shopify/sync-orders', requireShopifyAdminSession, async (req, res) => {
  try {
    const requestedPages = Math.floor(Number(req.body?.maxPages || 5));
    const maxPages = Math.min(5, Math.max(1, requestedPages));
    let cursor = req.body?.after ? String(req.body.after) : null;
    let imported = 0;
    let created = 0;
    let updated = 0;
    let pagesProcessed = 0;
    let hasMore = false;

    while (pagesProcessed < maxPages) {
      const data = await shopifyGraphql(SHOPIFY_ORDERS_SYNC_QUERY, { after: cursor });
      const connection = data.orders;
      if (!connection) throw new Error('Shopify returned no orders connection.');

      const edges = connection.edges || [];
      for (const edge of edges) {
        const mapped = mapShopifyGraphqlOrderToAtwok(edge.node);
        const result = await saveOrUpdateOrder(mapped);
        imported += 1;
        if (result.status === 'created') created += 1;
        else updated += 1;
        cursor = edge.cursor;
      }

      pagesProcessed += 1;
      hasMore = Boolean(connection.pageInfo?.hasNextPage);
      if (!hasMore || !edges.length) break;
      cursor = connection.pageInfo?.endCursor || cursor;
    }

    return res.json({
      success: true,
      shop: `${SHOPIFY_SHOP}.myshopify.com`,
      imported,
      created,
      updated,
      pagesProcessed,
      hasMore,
      nextCursor: hasMore ? cursor : null,
      message: hasMore
        ? `Imported ${imported} orders. Run sync again with nextCursor to continue.`
        : `Shopify order import complete. Processed ${imported} orders in this batch.`
    });
  } catch (error) {
    console.error('Shopify order import failed:', error?.response?.data || error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Shopify order import failed.'
    });
  }
});

async function resolveShopifyOrder(orderIdentifier) {
  const identifier = String(orderIdentifier || '').trim();
  if (!identifier) throw new Error('Provide a Shopify order ID or order name.');

  if (identifier.startsWith('gid://shopify/Order/')) {
    const data = await shopifyGraphql(`
      query AtwokFindOrderById($id: ID!) {
        order(id: $id) { id name }
      }
    `, { id: identifier });
    if (!data.order) throw new Error('Shopify order was not found.');
    return data.order;
  }

  const searchName = identifier.replace(/^#+/, '');
  const search = `name:"${searchName.replace(/["\\]/g, '')}"`;
  const data = await shopifyGraphql(`
    query AtwokFindOrderByName($search: String!) {
      orders(first: 1, query: $search) {
        nodes { id name }
      }
    }
  `, { search });

  const order = data.orders?.nodes?.[0];
  if (!order) throw new Error(`Shopify order ${identifier} was not found.`);
  return order;
}

// Updates only supported order attributes. Line-item/quantity/discount changes
// require Shopify's separate order-edit workflow and are intentionally not done here.
app.post('/api/shopify/orders/update', requireShopifyAdminSession, async (req, res) => {
  try {
    const orderIdentifier = req.body?.orderId || req.body?.shopifyOrderId || req.body?.orderGid;
    const order = await resolveShopifyOrder(orderIdentifier);
    const input = { id: order.id };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
      input.email = String(req.body.email || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
      input.phone = String(req.body.phone || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'note')) {
      input.note = String(req.body.note || '');
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tags')) {
      if (!Array.isArray(req.body.tags)) {
        return res.status(400).json({ success: false, message: 'tags must be an array of strings.' });
      }
      input.tags = req.body.tags.map(value => String(value).trim()).filter(Boolean);
    }
    if (req.body?.shippingAddress && typeof req.body.shippingAddress === 'object') {
      const allowedAddressFields = [
        'firstName', 'lastName', 'company', 'address1', 'address2',
        'city', 'province', 'provinceCode', 'country', 'countryCode',
        'zip', 'phone'
      ];
      input.shippingAddress = {};
      for (const key of allowedAddressFields) {
        if (Object.prototype.hasOwnProperty.call(req.body.shippingAddress, key)) {
          input.shippingAddress[key] = String(req.body.shippingAddress[key] ?? '');
        }
      }
    }

    if (Object.keys(input).length === 1) {
      return res.status(400).json({
        success: false,
        message: 'No editable fields were provided.'
      });
    }

    const result = await shopifyGraphql(`
      mutation AtwokOrderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id name email phone note }
          userErrors { field message }
        }
      }
    `, { input });

    const payload = result.orderUpdate;
    if (!payload) throw new Error('Shopify returned no orderUpdate result.');
    if (payload.userErrors?.length) {
      throw new Error(payload.userErrors.map(item => item.message).join('; '));
    }

    // Keep the matching A2K Firestore record in step for fields changed here.
    const orderName = payload.order?.name || order.name;
    const matches = await db.collection('orders')
      .where('shopifyOrderId', '==', orderName)
      .limit(1)
      .get();

    if (!matches.empty) {
      const firestoreUpdate = { shopifyGid: order.id, shopifyUpdatedAt: new Date().toISOString() };
      if (input.email !== undefined) firestoreUpdate.email = input.email;
      if (input.phone !== undefined) firestoreUpdate.phone = input.phone;
      if (input.shippingAddress) {
        const a = input.shippingAddress;
        firestoreUpdate.receiverAddress1 = a.address1 ?? '';
        firestoreUpdate.receiverAddress2 = a.address2 ?? '';
        firestoreUpdate.receiverCity = a.city ?? '';
        firestoreUpdate.receiverState = a.province ?? a.provinceCode ?? '';
        firestoreUpdate.receiverPincode = a.zip ?? '';
        firestoreUpdate.address = [
          a.address1, a.address2, a.city, a.province || a.provinceCode, a.zip
        ].filter(Boolean).join(', ');
      }
      await matches.docs[0].ref.update(firestoreUpdate);
    }

    return res.json({
      success: true,
      order: payload.order,
      message: `Shopify order ${orderName} updated successfully.`
    });
  } catch (error) {
    console.error('Shopify order update failed:', error?.response?.data || error.message);
    return res.status(502).json({ success: false, message: error.message || 'Shopify order update failed.' });
  }
});

// Creates fulfilments for all open/in-progress merchant-managed fulfilment orders.
// A deliberate confirmation flag is required to prevent accidental dispatch.
app.post('/api/shopify/orders/fulfill', requireShopifyAdminSession, async (req, res) => {
  try {
    if (req.body?.confirmFulfillment !== true) {
      return res.status(400).json({
        success: false,
        message: 'Set confirmFulfillment: true only after the parcel is actually dispatched.'
      });
    }

    const trackingNumber = String(req.body?.trackingNumber || req.body?.trackingId || '').trim();
    if (!trackingNumber) {
      return res.status(400).json({ success: false, message: 'Tracking number is required.' });
    }

    const order = await resolveShopifyOrder(
      req.body?.orderId || req.body?.shopifyOrderId || req.body?.orderGid
    );

    const orderData = await shopifyGraphql(`
      query AtwokOrderFulfillmentOrders($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillmentOrders(first: 50) {
            nodes {
              id
              status
              requestStatus
              assignedLocation { location { id } }
            }
          }
        }
      }
    `, { id: order.id });

    const fulfillmentOrders = (orderData.order?.fulfillmentOrders?.nodes || [])
      .filter(item => ['OPEN', 'IN_PROGRESS'].includes(String(item.status || '').toUpperCase()));

    if (!fulfillmentOrders.length) {
      return res.status(409).json({
        success: false,
        message: 'No open merchant-managed fulfilment orders are available for this Shopify order.'
      });
    }

    const company = String(req.body?.company || 'India Post').trim();
    const trackingUrl = String(req.body?.trackingUrl || '').trim();
    const notifyCustomer = req.body?.notifyCustomer === true;
    const fulfilled = [];

    // Shopify requires fulfilment orders in one create call to belong to the same location.
    const byLocation = new Map();
    for (const item of fulfillmentOrders) {
      const locationId = item.assignedLocation?.location?.id || 'unknown';
      if (!byLocation.has(locationId)) byLocation.set(locationId, []);
      byLocation.get(locationId).push(item.id);
    }

    for (const ids of byLocation.values()) {
      const fulfillmentInput = {
        lineItemsByFulfillmentOrder: ids.map(id => ({ fulfillmentOrderId: id })),
        trackingInfo: {
          company,
          number: trackingNumber,
          ...(trackingUrl ? { url: trackingUrl } : {})
        },
        notifyCustomer
      };

      const result = await shopifyGraphql(`
        mutation AtwokCreateFulfillment($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
              trackingInfo { company number url }
            }
            userErrors { field message }
          }
        }
      `, { fulfillment: fulfillmentInput });

      const payload = result.fulfillmentCreate;
      if (!payload) throw new Error('Shopify returned no fulfillmentCreate result.');
      if (payload.userErrors?.length) {
        throw new Error(payload.userErrors.map(item => item.message).join('; '));
      }
      if (payload.fulfillment) fulfilled.push(payload.fulfillment);
    }

    const matches = await db.collection('orders')
      .where('shopifyOrderId', '==', order.name)
      .limit(1)
      .get();

    if (!matches.empty) {
      await matches.docs[0].ref.update({
        shopifyGid: order.id,
        shopifyFulfillmentStatus: 'FULFILLED',
        shopifyTrackingNumber: trackingNumber,
        shopifyTrackingCompany: company,
        shopifyFulfilledAt: new Date().toISOString()
      });
    }

    return res.json({
      success: true,
      orderName: order.name,
      fulfillments: fulfilled,
      message: `Shopify fulfilment created for ${order.name}.`
    });
  } catch (error) {
    console.error('Shopify fulfilment failed:', error?.response?.data || error.message);
    return res.status(502).json({ success: false, message: error.message || 'Shopify fulfilment failed.' });
  }
});


function normalizeHubShopifyOrderId(value) {
  return String(value || '').trim();
}

function getExactWhatsAppProductName(order) {
  if (!order || typeof order !== 'object') return '';

  const isPlaceholder = value => {
    const text = String(value ?? '').trim();
    return !text || /^(shopify product|shopify item|product|ordered item|unnamed product|item|your order)$/i.test(text);
  };

  const asTitle = value => {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      return isPlaceholder(text) ? '' : text;
    }
    if (value && typeof value === 'object') {
      return asTitle(
        value.title || value.name || value.product_title ||
        value.productName || value.product_name
      );
    }
    return '';
  };

  const titlesFrom = collection => {
    const items = Array.isArray(collection)
      ? collection
      : (collection && typeof collection === 'object' ? Object.values(collection) : []);
    return items
      .map(item => item?.title || item?.name || item?.product_title || item?.productName || item?.product_name)
      .map(asTitle)
      .filter(Boolean)
      .join(' + ');
  };

  const originalCandidates = [
    order.originalShopifyProductName,
    order.shopifyProductTitle,
    titlesFrom(order.line_items),
    titlesFrom(order.lineItems),
    titlesFrom(order.items),
    titlesFrom(order.orderItems),
    titlesFrom(order.products)
  ];

  for (const candidate of originalCandidates) {
    const title = asTitle(candidate);
    if (title) return title;
  }

  const directCandidates = [
    order.product,
    order.productName,
    order.product_name,
    order.productTitle,
    order.product_title,
    order.title,
    order.name,
    order.productDetailsSnapshot?.productName,
    order.productDetailsSnapshot?.title,
    order.productDetails?.productName,
    order.productDetails?.title,
    order.productInfo?.productName,
    order.productInfo?.title,
    order.line_items?.[0]?.product?.title,
    order.line_items?.[0]?.product?.name,
    order.lineItems?.[0]?.product?.title,
    order.lineItems?.[0]?.product?.name,
    order.items?.[0]?.product?.title,
    order.items?.[0]?.product?.name
  ];

  for (const candidate of directCandidates) {
    const title = asTitle(candidate);
    if (title) return title;
  }

  return '';
}

function getWhatsAppOrderPhone(order) {
  return normalizeWhatsAppPhone(order.phone || order.mobile || order.customerPhone || '');
}

function scoreWhatsAppOrderDocument(docSnap) {
  const data = docSnap.data() || {};
  let score = 0;
  const productTitle = getExactWhatsAppProductName(data);
  if (productTitle) score += 100 + Math.min(productTitle.length, 80) / 100;
  if (data.customerName) score += 10;
  if (data.phone || data.mobile || data.customerPhone) score += 10;
  if (data.amount !== undefined || data.price !== undefined) score += 5;
  if (data.createdAt || data.created_at) score += 1;
  return score;
}

function selectPreferredWhatsAppOrderDoc(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  return [...docs].sort((a, b) => {
    const scoreDifference = scoreWhatsAppOrderDocument(b) - scoreWhatsAppOrderDocument(a);
    if (scoreDifference !== 0) return scoreDifference;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

async function resolveOrdersByShopifyIds(orderIds) {
  const ordersRef = db.collection('orders');
  const variantsById = new Map();
  const allVariants = [];

  for (const requestedId of orderIds) {
    const variants = [...new Set([
      requestedId,
      requestedId.replace(/^#+/, ''),
      requestedId.startsWith('#') ? requestedId : `#${requestedId}`
    ].filter(Boolean))];
    variantsById.set(requestedId, variants);
    allVariants.push(...variants);
  }

  const uniqueVariants = [...new Set(allVariants)];
  const docsByRequestedId = new Map(orderIds.map(id => [id, new Map()]));

  const readFieldInBatches = async (field, values) => {
    for (let i = 0; i < values.length; i += 30) {
      const chunk = values.slice(i, i + 30);
      const snapshot = await ordersRef.where(field, 'in', chunk).get();
      snapshot.forEach(docSnap => {
        const data = docSnap.data() || {};
        const storedId = normalizeHubShopifyOrderId(data[field]);
        for (const requestedId of orderIds) {
          if (variantsById.get(requestedId).some(v => normalizeHubShopifyOrderId(v) === storedId)) {
            docsByRequestedId.get(requestedId).set(docSnap.id, docSnap);
          }
        }
      });
    }
  };

  await readFieldInBatches('shopifyOrderId', uniqueVariants);

  const missingIds = orderIds.filter(id => docsByRequestedId.get(id).size === 0);
  if (missingIds.length) {
    const missingVariants = [...new Set(missingIds.flatMap(id => variantsById.get(id)))];
    for (const legacyField of ['orderId', 'shopify_order_id']) {
      await readFieldInBatches(legacyField, missingVariants);
      if (missingIds.some(id => docsByRequestedId.get(id).size > 0)) break;
    }
  }

  const resolvedMap = new Map();
  for (const requestedId of orderIds) {
    const chosenDoc = selectPreferredWhatsAppOrderDoc([...docsByRequestedId.get(requestedId).values()]);
    if (chosenDoc) resolvedMap.set(requestedId, chosenDoc);
  }
  return resolvedMap;
}

function buildWhatsAppConfirmationMessage(order, template, requestedOrderId = '') {
  const customerName = String(order.customerName || 'Customer').trim();
  const productName = getExactWhatsAppProductName(order) || 'your order';
  const rawAmount = String(order.amount ?? order.price ?? '0').replace(/[₹,\s]/g, '');
  const numericAmount = Number(rawAmount);
  const price = Number.isFinite(numericAmount)
    ? numericAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : String(order.amount ?? order.price ?? '0');
  const orderId = String(order.shopifyOrderId || order.orderId || order.shopify_order_id || requestedOrderId || '').trim();

  return String(template)
    .replace(/\{name\}/gi, customerName)
    .replace(/\{product\}/gi, productName)
    .replace(/\{price\}/gi, price)
    .replace(/\{orderId\}/gi, orderId);
}

const WHATSAPP_BULK_SEND_DELAY_MS = 30 * 1000;
const waitForWhatsAppSendSlot = ms => new Promise(resolve => setTimeout(resolve, ms));

const whatsappJobs = new Map();

function createWhatsAppJob(type, total) {
  if (whatsappJobs.size > 100) {
    const oldestKey = whatsappJobs.keys().next().value;
    if (oldestKey) whatsappJobs.delete(oldestKey);
  }

  const jobId = `wa_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  whatsappJobs.set(jobId, {
    id: jobId,
    type,
    status: 'RUNNING',
    total,
    completed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    remaining: total,
    results: [],
    createdAt: Date.now(),
    finishedAt: null,
    error: ''
  });
  return jobId;
}

app.get('/api/whatsapp/jobs/:jobId', requireWhatsAppHubSession, (req, res) => {
  const job = whatsappJobs.get(String(req.params.jobId || ''));
  if (!job) {
    return res.status(404).json({ success: false, message: 'WhatsApp job not found or expired.' });
  }
  return res.json({
    success: true,
    job: {
      ...job,
      remaining: Math.max(0, job.total - job.completed)
    }
  });
});

const whatsAppOrderLookupCache = new Map();
const WHATSAPP_ORDER_LOOKUP_CACHE_TTL_MS = 5000;

// POST /api/whatsapp/orders/lookup
app.post('/api/whatsapp/orders/lookup', requireWhatsAppHubSession, async (req, res) => {
  try {
    const rawOrderIds = req.body?.orderIds;
    if (!Array.isArray(rawOrderIds) || rawOrderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one Shopify order ID.' });
    }

    const orderIds = [...new Set(rawOrderIds.map(normalizeHubShopifyOrderId).filter(Boolean))];
    if (orderIds.length > 100) {
      return res.status(400).json({ success: false, message: 'A maximum of 100 order IDs can be fetched at once.' });
    }

    const cacheKey = orderIds.slice().sort().join('|');
    const cachedLookup = whatsAppOrderLookupCache.get(cacheKey);
    if (cachedLookup && Date.now() - cachedLookup.cachedAt < WHATSAPP_ORDER_LOOKUP_CACHE_TTL_MS) {
      return res.json({ ...cachedLookup.payload, cached: true });
    }

    const resolvedDocs = await resolveOrdersByShopifyIds(orderIds);
    const foundById = new Map();

    for (const [requestedId, chosenDoc] of resolvedDocs.entries()) {
      const data = chosenDoc.data() || {};
      foundById.set(requestedId, {
        id: chosenDoc.id,
        shopifyOrderId: normalizeHubShopifyOrderId(
          data.shopifyOrderId || data.orderId || data.shopify_order_id || requestedId
        ),
        customerName: data.customerName || data.customer_name || '',
        phone: data.phone || data.mobile || data.customerPhone || '',
        product: getExactWhatsAppProductName(data),
        amount: data.amount ?? data.price ?? data.sellingPrice ?? data.totalPrice ?? '',
        createdAt: data.createdAt || data.created_at || null
      });
    }

    const orders = orderIds.map(id => foundById.get(id)).filter(Boolean);
    const notFound = orderIds.filter(id => !foundById.has(id));
    const payload = { success: true, requested: orderIds.length, found: orders.length, notFound, orders };

    whatsAppOrderLookupCache.set(cacheKey, { cachedAt: Date.now(), payload });
    if (whatsAppOrderLookupCache.size > 250) {
      const oldestKey = whatsAppOrderLookupCache.keys().next().value;
      if (oldestKey) whatsAppOrderLookupCache.delete(oldestKey);
    }

    return res.json(payload);
  } catch (error) {
    console.error('WhatsApp Hub order lookup error:', error?.stack || error?.message || error);
    const detail = String(error?.message || 'Unknown Firestore lookup error').slice(0, 240);
    return res.status(500).json({
      success: false,
      message: `Order lookup failed: ${detail}`
    });
  }
});

async function processWhatsAppBulkConfirmationQueue(jobId, orderIds, template) {
  const job = whatsappJobs.get(jobId);
  if (!job) return;

  const resolvedDocs = await resolveOrdersByShopifyIds(orderIds);
  let attemptedProviderSend = false;

  const recordResult = entry => {
    job.results.push(entry);
    if (entry.status === 'SENT') job.sent += 1;
    else if (entry.status === 'SKIPPED') job.skipped += 1;
    else job.failed += 1;
    job.completed += 1;
    job.remaining = Math.max(0, job.total - job.completed);
  };

  for (const requestedId of orderIds) {
    try {
      const orderDoc = resolvedDocs.get(requestedId);
      if (!orderDoc) {
        recordResult({ shopifyOrderId: requestedId, status: 'FAILED', error: 'Order not found in Firestore.' });
        continue;
      }

      const order = orderDoc.data() || {};
      const productName = getExactWhatsAppProductName(order);
      if (!productName) {
        console.error(`WhatsApp send blocked: no real product title found for ${requestedId}. Document: ${orderDoc.id}`);
        recordResult({
          shopifyOrderId: requestedId,
          status: 'FAILED',
          error: 'Product name is missing in the selected Firestore order. No message was sent.'
        });
        continue;
      }

      let phone;
      try {
        phone = getWhatsAppOrderPhone(order);
      } catch {
        recordResult({
          shopifyOrderId: requestedId,
          status: 'FAILED',
          error: 'Missing or invalid customer phone number.'
        });
        continue;
      }

      // Firestore transaction prevents parallel requests/tabs from sending
      // the same order-confirmation message more than once.
      const claim = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(orderDoc.ref);
        if (!fresh.exists) return { allowed: false, reason: 'Order no longer exists.' };
        const previous = fresh.data()?.whatsappConfirmation || {};
        if (previous.status === 'SENT') return { allowed: false, reason: 'Confirmation already sent.' };
        if (previous.status === 'SENDING') return { allowed: false, reason: 'Confirmation is already being sent.' };
        transaction.set(orderDoc.ref, { whatsappConfirmation: {
          ...previous, status: 'SENDING', startedAt: FieldValue.serverTimestamp(),
          requestedOrderId: requestedId, error: ''
        } }, { merge: true });
        return { allowed: true };
      });
      if (!claim.allowed) {
        recordResult({ shopifyOrderId: requestedId, status: 'SKIPPED', error: claim.reason });
        continue;
      }

      if (attemptedProviderSend) {
        await waitForWhatsAppSendSlot(WHATSAPP_BULK_SEND_DELAY_MS);
      }

      const message = buildWhatsAppConfirmationMessage(order, template, requestedId);
      console.log(`WhatsApp confirmation: order=${requestedId}, firestoreDoc=${orderDoc.id}, product="${productName}"`);

      attemptedProviderSend = true;
      const crmResponse = await axios.post(
        `${WACRM_API_BASE_URL}/api/enviar-texto/${encodeURIComponent(WACRM_API_TOKEN)}`,
        { phone, message },
        {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 30000
        }
      );

      if (crmResponse.data?.success !== true) {
        await orderDoc.ref.set({ whatsappConfirmation: {
          status: 'FAILED', failedAt: FieldValue.serverTimestamp(),
          error: crmResponse.data?.message || 'WhatsApp provider rejected the message.'
        } }, { merge: true });
        recordResult({
          shopifyOrderId: requestedId,
          status: 'FAILED',
          error: crmResponse.data?.message || 'WhatsApp provider rejected the message.'
        });
        continue;
      }

      await orderDoc.ref.set({
        whatsappConfirmation: {
          lastSentAt: FieldValue.serverTimestamp(),
          lastSentPhone: phone,
          lastMessage: message,
          lastProductName: productName,
          status: 'SENT',
          error: ''
        }
      }, { merge: true });

      recordResult({
        shopifyOrderId: requestedId,
        status: 'SENT',
        customerName: order.customerName || '',
        phone,
        product: productName
      });
    } catch (error) {
      console.error(`WhatsApp send failed for ${requestedId}:`, error?.response?.data || error?.message || error);
      // A timeout may mean the provider accepted the message but its response was lost.
      // Keep UNKNOWN in that case so an operator checks before retrying.
      try {
        const failedDoc = resolvedDocs.get(requestedId);
        if (failedDoc) await failedDoc.ref.set({ whatsappConfirmation: {
          status: error?.code === 'ECONNABORTED' ? 'UNKNOWN' : 'FAILED',
          failedAt: FieldValue.serverTimestamp(),
          error: error?.response?.data?.message || error?.message || 'Unable to send this WhatsApp message.'
        } }, { merge: true });
      } catch (saveError) {
        console.error('Could not save WhatsApp failure state:', saveError?.message || saveError);
      }
      recordResult({
        shopifyOrderId: requestedId,
        status: 'FAILED',
        error: error?.response?.data?.message || error?.message || 'Unable to send this WhatsApp message.'
      });
    }
  }

  job.status = 'COMPLETED';
  job.finishedAt = Date.now();
}

// POST /api/whatsapp/orders/send-bulk — responds 202 and sends in background
app.post('/api/whatsapp/orders/send-bulk', requireWhatsAppHubSession, async (req, res) => {
  const rawOrderIds = req.body?.orderIds;
  const template = String(req.body?.template || '').trim();

  if (!Array.isArray(rawOrderIds) || rawOrderIds.length === 0) {
    return res.status(400).json({ success: false, message: 'Please provide at least one Shopify order ID.' });
  }
  if (rawOrderIds.length > 50) {
    return res.status(400).json({ success: false, message: 'A maximum of 50 messages can be sent in one batch.' });
  }
  if (!template) {
    return res.status(400).json({ success: false, message: 'WhatsApp message template is required.' });
  }

  const orderIds = [...new Set(rawOrderIds.map(normalizeHubShopifyOrderId).filter(Boolean))];
  if (!orderIds.length) {
    return res.status(400).json({ success: false, message: 'No valid Shopify order IDs were provided.' });
  }

  const jobId = createWhatsAppJob('order-confirmation', orderIds.length);

  processWhatsAppBulkConfirmationQueue(jobId, orderIds, template).catch(err => {
    console.error('Unhandled error in WhatsApp bulk confirmation queue:', err);
    const job = whatsappJobs.get(jobId);
    if (job) {
      job.status = 'FAILED';
      job.error = err.message || 'Background job failed.';
      job.finishedAt = Date.now();
    }
  });

  return res.status(202).json({
    success: true,
    queued: true,
    jobId,
    total: orderIds.length,
    delayBetweenMessagesMs: WHATSAPP_BULK_SEND_DELAY_MS
  });
});

// ============================================================
// AUTOMATIC TRACKING WHATSAPP UPDATE
// ============================================================

function getAssignedTrackingId(order) {
  const candidates = [
    order?.trackingId,
    order?.trackingNumber,
    order?.tracking_id,
    order?.articleNumber,
    order?.barcode,
    order?.barcodeNo,
    order?.indiaPost?.articleNumber,
    order?.indiaPost?.barcode,
    order?.indiaPost?.trackingId
  ];

  for (const value of candidates) {
    const trackingId = String(value || '').trim();
    if (trackingId) return trackingId;
  }
  return '';
}

function formatTrackingAmount(value) {
  const raw = String(value ?? '').replace(/[₹,\s]/g, '');
  const amount = Number(raw);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : String(value ?? '');
}

function buildTrackingDispatchMessage(order, trackingId) {
  const customerName = String(order.customerName || 'Customer').trim();
  const productName = getExactWhatsAppProductName(order);
  const amount = formatTrackingAmount(order.amount ?? order.revenue ?? order.price ?? '');
  const paymentMode = String(order.paymentMode || (order.isPrepaid ? 'Prepaid' : 'COD')).trim();
  const trackingLink = `https://speedpost.live/track?n=${encodeURIComponent(trackingId)}`;

  return (
    `📦 ATWOK – ORDER DISPATCH UPDATE\n\n` +
    `Hello ${customerName}! 👋\n\n` +
    `Your order has been dispatched!\n\n` +
    `Product: ${productName}\n` +
    `Amount: ₹${amount}\n` +
    `Payment Mode: ${paymentMode}\n\n` +
    `🚚 Your product will be delivered within 2–3 days through India Post.\n\n` +
    `📍 Track Your Order Live:\n${trackingLink}\n\n` +
    `Thank you for choosing ATWOK! ❤️\n` +
    `– Team ATWOK`
  );
}

async function processTrackingWhatsAppQueue(jobId, orderDocIds) {
  const job = whatsappJobs.get(jobId);
  if (!job) return;

  let attemptedProviderSend = false;

  const recordResult = entry => {
    job.results.push(entry);
    if (entry.status === 'SENT') job.sent += 1;
    else if (entry.status === 'SKIPPED') job.skipped += 1;
    else job.failed += 1;
    job.completed += 1;
    job.remaining = Math.max(0, job.total - job.completed);
  };

  for (const orderDocId of orderDocIds) {
    let orderRef = null;
    let trackingId = '';

    try {
      orderRef = db.collection('orders').doc(orderDocId);
      const orderSnapshot = await orderRef.get();

      if (!orderSnapshot.exists) {
        recordResult({
          orderDocId,
          status: 'FAILED',
          error: 'Order not found in the backend Firestore orders collection.'
        });
        continue;
      }

      const order = orderSnapshot.data() || {};
      trackingId = getAssignedTrackingId(order);

      if (!trackingId) {
        recordResult({
          orderDocId,
          status: 'FAILED',
          error: 'Tracking ID is missing. No WhatsApp message was sent.'
        });
        continue;
      }

      const productName = getExactWhatsAppProductName(order);
      if (!productName) {
        recordResult({
          orderDocId,
          trackingId,
          status: 'FAILED',
          error: 'Product name is missing. No WhatsApp message was sent.'
        });
        continue;
      }

      let phone;
      try {
        phone = getWhatsAppOrderPhone(order);
      } catch {
        recordResult({
          orderDocId,
          trackingId,
          status: 'FAILED',
          error: 'Customer phone number is missing or invalid.'
        });
        continue;
      }

      const claim = await db.runTransaction(async transaction => {
        const freshSnapshot = await transaction.get(orderRef);
        if (!freshSnapshot.exists) return { allowed: false, reason: 'Order not found.' };

        const freshOrder = freshSnapshot.data() || {};
        const freshTrackingId = getAssignedTrackingId(freshOrder);
        if (freshTrackingId !== trackingId) {
          return { allowed: false, reason: 'Tracking ID changed while preparing the message.' };
        }

        const previous = freshOrder.trackingWhatsApp || {};
        if (previous.lastSentTrackingId === trackingId && previous.status === 'SENT') {
          return { allowed: false, reason: 'Already sent for this tracking ID.', alreadySent: true };
        }
        if (previous.pendingTrackingId === trackingId && previous.status === 'SENDING') {
          return { allowed: false, reason: 'A message for this tracking ID is already being sent.', inProgress: true };
        }

        transaction.set(orderRef, {
          trackingWhatsApp: {
            ...previous,
            pendingTrackingId: trackingId,
            status: 'SENDING',
            startedAt: FieldValue.serverTimestamp(),
            error: ''
          }
        }, { merge: true });

        return { allowed: true };
      });

      if (!claim.allowed) {
        recordResult({
          orderDocId,
          trackingId,
          status: claim.alreadySent || claim.inProgress ? 'SKIPPED' : 'FAILED',
          error: claim.reason
        });
        continue;
      }

      if (attemptedProviderSend) {
        await waitForWhatsAppSendSlot(WHATSAPP_BULK_SEND_DELAY_MS);
      }

      const message = buildTrackingDispatchMessage(order, trackingId);
      attemptedProviderSend = true;

      const crmResponse = await axios.post(
        `${WACRM_API_BASE_URL}/api/enviar-texto/${encodeURIComponent(WACRM_API_TOKEN)}`,
        { phone, message },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 30000
        }
      );

      if (crmResponse.data?.success !== true) {
        throw new Error(crmResponse.data?.message || 'WhatsApp provider rejected the tracking message.');
      }

      await orderRef.set({
        trackingWhatsApp: {
          lastSentTrackingId: trackingId,
          pendingTrackingId: '',
          lastSentAt: FieldValue.serverTimestamp(),
          lastSentPhone: phone,
          lastMessage: message,
          lastProductName: productName,
          status: 'SENT',
          error: ''
        }
      }, { merge: true });

      recordResult({
        orderDocId,
        trackingId,
        status: 'SENT',
        customerName: order.customerName || '',
        phone,
        product: productName
      });
    } catch (error) {
      console.error(
        `Automatic tracking WhatsApp failed for ${orderDocId}:`,
        error?.response?.data || error?.message || error
      );

      if (orderRef && trackingId) {
        try {
          await orderRef.set({
            trackingWhatsApp: {
              pendingTrackingId: '',
              failedTrackingId: trackingId,
              failedAt: FieldValue.serverTimestamp(),
              status: 'FAILED',
              error: error?.response?.data?.message || error?.message || 'WhatsApp send failed.'
            }
          }, { merge: true });
        } catch (saveError) {
          console.error('Could not save tracking WhatsApp failure status:', saveError?.message || saveError);
        }
      }

      recordResult({
        orderDocId,
        trackingId,
        status: 'FAILED',
        error: error?.response?.data?.message || error?.message || 'Unable to send tracking WhatsApp message.'
      });
    }
  }

  job.status = 'COMPLETED';
  job.finishedAt = Date.now();
}

// POST /api/whatsapp/tracking/send
app.post('/api/whatsapp/tracking/send', requireWhatsAppHubSession, async (req, res) => {
  const rawOrderDocIds = req.body?.orderDocIds;

  if (!Array.isArray(rawOrderDocIds) || rawOrderDocIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Please provide at least one order document ID.'
    });
  }

  const orderDocIds = [...new Set(
    rawOrderDocIds.map(value => String(value || '').trim()).filter(Boolean)
  )];

  if (orderDocIds.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'A maximum of 100 tracking updates can be processed at once.'
    });
  }

  const jobId = createWhatsAppJob('tracking-dispatch', orderDocIds.length);

  processTrackingWhatsAppQueue(jobId, orderDocIds).catch(err => {
    console.error('Unhandled error in tracking WhatsApp queue:', err);
    const job = whatsappJobs.get(jobId);
    if (job) {
      job.status = 'FAILED';
      job.error = err.message || 'Background job failed.';
      job.finishedAt = Date.now();
    }
  });

  return res.status(202).json({
    success: true,
    queued: true,
    jobId,
    total: orderDocIds.length,
    delayBetweenMessagesMs: WHATSAPP_BULK_SEND_DELAY_MS
  });
});

// ============================================================
// SERVER START
// ============================================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 ATWOK Backend running on port ${PORT}`);
  console.log(`🩺 ATWOK API build: ${ATWOK_API_BUILD}`);
  console.log('📲 WhatsApp tracking route: POST /api/whatsapp/tracking/send');
});
