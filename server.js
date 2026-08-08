const express = require('express');
const cors = require('cors');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase using your service account key
const serviceAccount = require('./serviceAccountKey.json');

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

// HEALTH CHECK / MANUAL SYNC ROUTE
app.get('/api/sync-last-order', (req, res) => {
  console.log("🔄 Manual Sync Ping Received from Frontend!");
  return res.status(200).json({ 
    success: true, 
    message: "Backend awake and listening for orders!" 
  });
});

// SHOPIFY WEBHOOK RECEIVER
// SHOPIFY WEBHOOK RECEIVER
app.post('/api/shopify-webhook', async (req, res) => {
  try {
    const order = req.body;

    // Parse shipping address cleanly
    const shipping = order.shipping_address || order.billing_address || {};
    const addressParts = [
      shipping.address1,
      shipping.address2,
      shipping.city,
      shipping.province,
      shipping.zip
    ].filter(Boolean);
    const fullAddress = addressParts.join(', ');

    // Extract Product Title / Heading
    let productTitle = 'Shopify Item';
    if (order.line_items && order.line_items.length > 0) {
      const item = order.line_items[0];
      productTitle = item.title || item.name || item.sku || 'Shopify Item';
    }

    // 🟢 NEW: EXTRA PHONE NUMBER EXTRACTION FROM EASYSELL
    let mainPhone = shipping.phone || order.phone || order.billing_address?.phone || '';
    let extraPhone = '';

    if (order.note_attributes && order.note_attributes.length > 0) {
      // Loop through attributes to find the extra mobile field
      const extraPhoneAttribute = order.note_attributes.find(attr => 
        attr.name.toLowerCase().includes('phone') || 
        attr.name.toLowerCase().includes('mobile') || 
        attr.name.toLowerCase().includes('extra')
      );
      if (extraPhoneAttribute) {
        extraPhone = extraPhoneAttribute.value;
      }
    }

    // Combine them beautifully so your operators see both inside the Call Terminal cell!
    let displayPhone = mainPhone;
    if (extraPhone && extraPhone !== mainPhone) {
      displayPhone = `${mainPhone} / ${extraPhone}`;
    }

    const newOrder = {
      shopifyOrderId: order.name || `#${order.order_number}`,
      customerName: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || order.customer?.first_name || 'Guest Customer',
      phone: displayPhone, // Now holds both numbers if present!
      address: fullAddress,
      product: productTitle,
      amount: String(order.total_price || '0'),
      paymentMode: 'COD',
      createdAt: order.created_at || new Date().toISOString(),
      status: 'Pending',
      remarks: ''
    };

    await db.collection('orders').add(newOrder);

    console.log(`⚡ Webhook Success: Order ${newOrder.shopifyOrderId} parsed with Phone: ${newOrder.phone}`);
    return res.status(200).send('Webhook Processed Successfully');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).send('Webhook Handler Failed');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));