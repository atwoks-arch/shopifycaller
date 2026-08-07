const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// SHOPIFY DIRECT WEBHOOK RECEIVER
exports.shopifyWebhook = functions.https.onRequest(async (req, res) => {
  // Only process POST requests from Shopify
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const order = req.body;

    // Parse clean shipping address
    const shipping = order.shipping_address || {};
    const addressParts = [
      shipping.address1,
      shipping.address2,
      shipping.city,
      shipping.province,
      shipping.zip
    ].filter(Boolean);
    const fullAddress = addressParts.join(", ");

    // Extract product SKU or item name fallback
    const lineItem = (order.line_items && order.line_items.length > 0) ? order.line_items[0] : {};
    const productSku = lineItem.sku || lineItem.name || "";

    // Determine payment mode (COD vs Prepaid)
    let paymentMode = "COD";
    if (order.financial_status === "paid" || (order.gateway && order.gateway.toLowerCase().includes("prepaid"))) {
      paymentMode = "Prepaid";
    }

    // Build document payload matching React dashboard structure
    const newOrder = {
      shopifyOrderId: order.name || `#${order.order_number}`,
      customerName: `${shipping.first_name || ""} ${shipping.last_name || ""}`.trim() || order.customer?.first_name || "Guest Customer",
      phone: shipping.phone || order.phone || order.billing_address?.phone || "",
      address: fullAddress,
      product: productSku,
      amount: String(order.total_price || "0"),
      paymentMode: paymentMode,
      createdAt: order.created_at, // Preserves exact Shopify date and time
      status: "Pending",
      remarks: ""
    };

    // Write directly into Firestore 'orders' collection
    await db.collection("orders").add(newOrder);

    console.log(`⚡ Direct Webhook Success: Order ${newOrder.shopifyOrderId} written to Firestore!`);
    return res.status(200).send("Webhook Processed Successfully");
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).send("Webhook Handler Failed");
  }
});