const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase using your downloaded key
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps || !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// SHOPIFY WEBHOOK RECEIVER
app.post('/api/shopify-webhook', async (req, res) => {
  try {
    const order = req.body;

    // Parse shipping address cleanly
    const shipping = order.shipping_address || {};
    const addressParts = [
      shipping.address1,
      shipping.address2,
      shipping.city,
      shipping.province,
      shipping.zip
    ].filter(Boolean);
    const fullAddress = addressParts.join(', ');

    // Extract product info
    const lineItem = (order.line_items && order.line_items.length > 0) ? order.line_items[0] : {};
    const productSku = lineItem.sku || lineItem.name || '';

    // Determine payment mode (COD vs Prepaid)
    let paymentMode = 'COD';
    if (order.financial_status === 'paid' || (order.gateway && order.gateway.toLowerCase().includes('prepaid'))) {
      paymentMode = 'Prepaid';
    }

    const newOrder = {
      shopifyOrderId: order.name || `#${order.order_number}`,
      customerName: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || order.customer?.first_name || 'Guest Customer',
      phone: shipping.phone || order.phone || order.billing_address?.phone || '',
      address: fullAddress,
      product: productSku,
      amount: String(order.total_price || '0'),
      paymentMode: paymentMode,
      createdAt: order.created_at,
      status: 'Pending',
      remarks: ''
    };

    await db.collection('orders').add(newOrder);

    console.log(`⚡ Direct Webhook Success: Order ${newOrder.shopifyOrderId} written to Firestore!`);
    return res.status(200).send('Webhook Processed Successfully');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).send('Webhook Handler Failed');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));