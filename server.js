```javascript
  new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '');

  return `ATWOK-${date}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}


// ============================================================
// INDIA POST BBD01 PAYLOAD BUILDER
// ============================================================

function buildIndiaPostArticle(order) {

  const validation =
    validateIndiaPostOrder(order);

  if (!validation.valid) {
    throw new Error(
      validation.errors.join(', ')
    );
  }

  const {
    phone,
    receiver,
    barcode,
    isPrepaid
  } = validation.sanitized;

  const amount =
    Number(order.amount || 0);

  const codAmount =
    isPrepaid ? 0 : amount;

  return {
    articleNumber: barcode,
    articleType: INDIA_POST_ARTICLE_TYPE,
    physicalWeight: INDIA_POST_PHYSICAL_WEIGHT,
    length: INDIA_POST_LENGTH,
    breadth: INDIA_POST_BREADTH,
    height: INDIA_POST_HEIGHT,

    senderName: INDIA_POST_SENDER_NAME,
    senderCompanyName: INDIA_POST_SENDER_COMPANY,
    senderAddressLine1: INDIA_POST_SENDER_ADDRESS_1,
    senderAddressLine2: INDIA_POST_SENDER_ADDRESS_2,
    senderCity: INDIA_POST_SENDER_CITY,
    senderState: INDIA_POST_SENDER_STATE,
    senderPincode: INDIA_POST_SENDER_PINCODE,
    senderEmail: INDIA_POST_SENDER_EMAIL,
    senderMobile: INDIA_POST_SENDER_MOBILE,

    receiverName: order.customerName,
    receiverAddressLine1: receiver.line1,
    receiverAddressLine2: receiver.line2,
    receiverCity: receiver.city,
    receiverState: receiver.state,
    receiverPincode: receiver.pincode,
    receiverMobile: phone,

    customerId: INDIA_POST_CUSTOMER_ID,
    contractId: INDIA_POST_CONTRACT_ID,
    officeId: INDIA_POST_OFFICE_ID,

    codAmount
  };
}


// ============================================================
// FIRESTORE ORDER HELPERS
// ============================================================

function getOrderCollection() {
  return db.collection('orders');
}


async function getOrderByShopifyId(shopifyOrderId) {

  const normalizedId =
    String(shopifyOrderId || '').trim();

  if (!normalizedId) {
    return null;
  }

  const snapshot =
    await getOrderCollection()
      .where('shopifyOrderId', '==', normalizedId)
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  const doc =
    snapshot.docs[0];

  return {
    id: doc.id,
    ...doc.data()
  };
}


// ============================================================
// SHOPIFY ORDER UPSERT
// ============================================================

async function upsertShopifyOrder(orderData) {

  const shopifyOrderId =
    String(
      orderData.id ||
      orderData.order_id ||
      orderData.shopifyOrderId ||
      ''
    ).trim();

  if (!shopifyOrderId) {
    throw new Error(
      'Shopify order ID is missing.'
    );
  }

  const orderRef =
    getOrderCollection()
      .doc(shopifyOrderId);

  const existingSnapshot =
    await orderRef.get();

  const existingData =
    existingSnapshot.exists
      ? existingSnapshot.data()
      : {};

  const customer =
    orderData.customer || {};

  const shippingAddress =
    orderData.shipping_address ||
    orderData.billing_address ||
    {};

  const lineItems =
    Array.isArray(orderData.line_items)
      ? orderData.line_items
      : [];

  const productNames =
    lineItems
      .map(item => item.title)
      .filter(Boolean);

  const product =
    productNames.join(', ') ||
    existingData.product ||
    'Shopify product';

  const phone =
    orderData.phone ||
    shippingAddress.phone ||
    customer.phone ||
    existingData.phone ||
    '';

  const customerName =
    [
      shippingAddress.first_name ||
        customer.first_name ||
        '',
      shippingAddress.last_name ||
        customer.last_name ||
        ''
    ]
      .filter(Boolean)
      .join(' ') ||
    existingData.customerName ||
    '';

  const address =
    [
      shippingAddress.address1 || '',
      shippingAddress.address2 || '',
      shippingAddress.city || '',
      shippingAddress.province || '',
      shippingAddress.zip || ''
    ]
      .filter(Boolean)
      .join(', ');

  const amount =
    Number(
      orderData.total_price ||
      orderData.current_total_price ||
      existingData.amount ||
      0
    );

  const paymentMode =
    orderData.financial_status === 'paid'
      ? 'Prepaid'
      : 'COD';

  const updateData = {
    shopifyOrderId,
    customerName,
    phone,
    product,
    amount,
    address,
    paymentMode,
    shopifyFinancialStatus:
      orderData.financial_status || '',
    shopifyFulfillmentStatus:
      orderData.fulfillment_status || '',
    updatedAt:
      FieldValue.serverTimestamp()
  };

  if (!existingSnapshot.exists) {
    updateData.createdAt =
      FieldValue.serverTimestamp();
  }

  await orderRef.set(
    updateData,
    { merge: true }
  );

  return {
    id: orderRef.id,
    ...updateData
  };
}


// ============================================================
// WHATSAPP CONFIGURATION
// ============================================================

const WACRM_API_BASE_URL =
  'https://api-whatsapp.wacrmpro.in';

const WACRM_API_TOKEN =
  process.env.WACRM_API_TOKEN || '';

const WACRM_TEST_API_KEY =
  process.env.WACRM_TEST_API_KEY || '';


// ============================================================
// WHATSAPP PHONE NORMALIZATION
// ============================================================

function normalizeWhatsAppPhone(phone) {

  if (!phone) {
    return '';
  }

  let value =
    String(phone)
      .split(/[/,;|]/)[0]
      .trim()
      .replace(/\D/g, '');

  if (value.length === 10) {
    value = `91${value}`;
  }

  if (value.length === 12 && value.startsWith('91')) {
    return value;
  }

  if (value.length > 12) {
    value = value.slice(-12);
  }

  return value;
}


// ============================================================
// WHATSAPP TEST API KEY MIDDLEWARE
// ============================================================

function requireWhatsAppHubKey(req, res, next) {

  if (!WACRM_TEST_API_KEY) {
    return res.status(500).json({
      success: false,
      message:
        'WhatsApp Hub API key is not configured on the server.'
    });
  }

  const suppliedKey =
    req.headers['x-atwok-test-key'];

  if (
    !suppliedKey ||
    suppliedKey !== WACRM_TEST_API_KEY
  ) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized.'
    });
  }

  next();
}


// ============================================================
// NORMALIZE SHOPIFY ORDER ID
// ============================================================

function normalizeShopifyOrderId(value) {

  return String(value || '')
    .trim()
    .replace(/^#/, '');
}


// ============================================================
// WHATSAPP MESSAGE BUILDER
// ============================================================

function buildWhatsAppConfirmationMessage(
  order,
  template
) {

  const name =
    String(order.customerName || 'Customer')
      .trim();

  const product =
    String(order.product || 'your product')
      .trim();

  const amount =
    Number(order.amount || 0);

  const formattedPrice =
    Number.isFinite(amount)
      ? amount.toLocaleString('en-IN')
      : String(order.amount || '');

  const defaultTemplate = `Hello {name},

We tried calling you regarding your order for *{product}*, worth ₹{price}. We couldn't connect with you.

Please confirm your order by replying **CONFIRMED** so we can process your shipment.

Thank you – ATWOK.`;

  const selectedTemplate =
    String(template || defaultTemplate);

  return selectedTemplate
    .replace(/\{name\}/gi, name)
    .replace(/\{product\}/gi, product)
    .replace(/\{price\}/gi, formattedPrice);
}


// ============================================================
// GET WHATSAPP ORDER PHONE
// ============================================================

function getWhatsAppOrderPhone(order) {

  return normalizeWhatsAppPhone(
    order.phone ||
    order.mobile ||
    order.customerPhone ||
    ''
  );
}


// ============================================================
// SEND WHATSAPP TEXT
// ============================================================

async function sendWhatsAppText(phone, message) {

  if (!WACRM_API_TOKEN) {
    throw new Error(
      'WACRM_API_TOKEN is not configured.'
    );
  }

  const normalizedPhone =
    normalizeWhatsAppPhone(phone);

  if (!normalizedPhone) {
    throw new Error(
      'Customer WhatsApp number is missing or invalid.'
    );
  }

  const response =
    await axios.post(
      `${WACRM_API_BASE_URL}/api/enviar-texto/${WACRM_API_TOKEN}`,
      {
        phone: normalizedPhone,
        message
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

  if (
    response.data?.success === false ||
    response.data?.status === 'error'
  ) {
    throw new Error(
      response.data?.message ||
      'WACRM could not send the WhatsApp message.'
    );
  }

  return response.data;
}
  const date =
    new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

  const random =
    Math.floor(
      1000 + Math.random() * 9000
    );

  return `ATWOK-${date}-${random}`;
}


// ============================================================
// FIREBASE ORDER UPSERT
// ============================================================

async function saveOrUpdateOrder(newOrder) {

  const ordersRef =
    db.collection('orders');

  const snapshot =
    await ordersRef
      .where(
        'shopifyOrderId',
        '==',
        newOrder.shopifyOrderId
      )
      .get();

  if (!snapshot.empty) {

    const existingDocId =
      snapshot.docs[0].id;

    // IMPORTANT:
    // Don't overwrite the existing indiaPost object.
    // Shopify webhook updates should not destroy booking data.

    await ordersRef
      .doc(existingDocId)
      .update({
        customerName:
          newOrder.customerName,

        phone:
          newOrder.phone,

        address:
          newOrder.address,

        receiverAddress1:
          newOrder.receiverAddress1 || '',

        receiverAddress2:
          newOrder.receiverAddress2 || '',

        receiverCity:
          newOrder.receiverCity || '',

        receiverState:
          newOrder.receiverState || '',

        receiverPincode:
          newOrder.receiverPincode || '',

        product:
          newOrder.product,

        amount:
          newOrder.amount,

        paymentMode:
          newOrder.paymentMode,

        createdAt:
          newOrder.createdAt,

        status:
          newOrder.status,

        remarks:
          newOrder.remarks
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

app.get(
  '/api/sync-last-order',
  (req, res) => {

    console.log(
      '🔄 Manual Sync Ping Received from Frontend!'
    );

    return res.status(200).json({
      success: true,
      message:
        'Backend awake and listening for orders!'
    });
  }
);


// ============================================================
// INDIA POST BULK BOOKING
// BBD01
// ============================================================

app.post(
  '/api/india-post/book',
  async (req, res) => {

    const batchId =
      generateBatchId();

    try {

      const { orderIds } =
        req.body;

      if (
        !Array.isArray(orderIds) ||
        orderIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'No order IDs provided.'
        });
      }


      // Prevent extremely large accidental requests.
      if (orderIds.length > 5000) {
        return res.status(400).json({
          success: false,
          message:
            'Maximum 5,000 orders can be submitted in one BBD01 batch.'
        });
      }


      const ordersRef =
        db.collection('orders');

      const results = [];

      const validArticlesForApi = [];


      let bookedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;


      // ======================================================
      // FETCH + VALIDATE + LOCK
      // ======================================================

      for (
        const orderId of orderIds
      ) {

        const docRef =
          ordersRef.doc(orderId);

        const docSnap =
          await docRef.get();


        if (!docSnap.exists) {

          results.push({
            orderId,
            status: 'SKIPPED',
            error:
              'Order not found in Firestore'
          });

          skippedCount++;

          continue;
        }


        const orderData =
          docSnap.data();


        const existingStatus =
          orderData.indiaPost?.status ||
          'NOT_BOOKED';


        // ----------------------------------------------------
        // Already booked
        // ----------------------------------------------------

        if (
          existingStatus === 'BOOKED'
        ) {

          results.push({
            orderId,
            shopifyOrderId:
              orderData.shopifyOrderId,
            status: 'SKIPPED',
            error:
              'Already booked with India Post',
            articleNumber:
              orderData.indiaPost?.articleNumber ||
              '',
            barcode:
              orderData.indiaPost?.barcode ||
              ''
          });

          skippedCount++;

          continue;
        }


        // ----------------------------------------------------
        // Validate order
        // ----------------------------------------------------

        const validation =
          validateIndiaPostOrder(orderData);


        if (!validation.valid) {

          results.push({
            orderId,
            shopifyOrderId:
              orderData.shopifyOrderId,
            status: 'FAILED',
            error:
              validation.errors.join('; ')
          });

          failedCount++;

          continue;
        }


        // ----------------------------------------------------
        // Build API article
        // ----------------------------------------------------

        try {

          const article =
            buildIndiaPostArticle(orderData);

          validArticlesForApi.push({
            orderId,
            docRef,
            article,
            orderData
          });

        } catch (error) {

          results.push({
            orderId,
            shopifyOrderId:
              orderData.shopifyOrderId,
            status: 'FAILED',
            error: error.message
          });

          failedCount++;
        }
      }


      // ======================================================
      // NO VALID ARTICLES
      // ======================================================

      if (
        validArticlesForApi.length === 0
      ) {

        return res.status(200).json({
          success: true,
          batchId,
          message:
            'No valid articles available for booking.',
          summary: {
            total: orderIds.length,
            booked: bookedCount,
            failed: failedCount,
            skipped: skippedCount
          },
          results
        });
      }


      // ======================================================
      // BUILD BBD01 REQUEST
      // ======================================================

      const articles =
        validArticlesForApi.map(
          item => item.article
        );


      console.log(
        `📦 BBD01: Sending ${articles.length} articles to India Post...`
      );


      // ======================================================
      // SUBMIT TO INDIA POST
      // ======================================================

      let bookingResponse;

      try {

        bookingResponse =
          await makeIndiaPostRequest({
            method: 'POST',
            url: INDIA_POST_BOOKING_URL,
            data: {
              customerId:
                INDIA_POST_CUSTOMER_ID,

              contractId:
                INDIA_POST_CONTRACT_ID,

              officeId:
                INDIA_POST_OFFICE_ID,

              batchId,

              articles
            },
            headers: {
              accept: 'application/json',
              'Content-Type': 'application/json'
            },
            timeout: 120000
          });

      } catch (error) {

        console.error(
          '❌ India Post BBD01 request failed:',
          error?.response?.data ||
          error.message
        );

        for (
          const item of validArticlesForApi
        ) {

          results.push({
            orderId: item.orderId,
            shopifyOrderId:
              item.orderData.shopifyOrderId,
            status: 'FAILED',
            error:
              error?.response?.data?.message ||
              error.message ||
              'India Post booking request failed'
          });

          failedCount++;
        }

        return res.status(200).json({
          success: false,
          batchId,
          message:
            'India Post booking request failed.',
          summary: {
            total: orderIds.length,
            booked: bookedCount,
            failed: failedCount,
            skipped: skippedCount
          },
          results
        });
      }


      // ======================================================
      // PROCESS BBD01 RESPONSE
      // ======================================================

      const responseData =
        bookingResponse.data || {};

      console.log(
        '📨 India Post BBD01 response:',
        JSON.stringify(responseData)
      );


      const responseArticles =
        responseData.articles ||
        responseData.data?.articles ||
        responseData.data ||
        [];


      // ======================================================
      // UPDATE FIRESTORE
      // ======================================================

      for (
        let index = 0;
        index < validArticlesForApi.length;
        index++
      ) {

        const item =
          validArticlesForApi[index];

        const apiArticle =
          Array.isArray(responseArticles)
            ? responseArticles[index] || {}
            : {};


        const articleNumber =
          apiArticle.articleNumber ||
          apiArticle.barcode ||
          item.article.articleNumber;


        const articleStatus =
          String(
            apiArticle.status ||
            responseData.status ||
            ''
          ).toUpperCase();


        const isSuccess =
          responseData.success === true ||
          articleStatus === 'SUCCESS' ||
          articleStatus === 'BOOKED' ||
          articleStatus === 'ACCEPTED';


        if (!isSuccess) {

          results.push({
            orderId: item.orderId,
            shopifyOrderId:
              item.orderData.shopifyOrderId,
            status: 'FAILED',
            articleNumber,
            error:
              apiArticle.message ||
              apiArticle.error ||
              responseData.message ||
              'India Post did not confirm booking'
          });

          failedCount++;

          continue;
        }


        try {

          await item.docRef.update({

            indiaPost: {
              status: 'BOOKED',
              articleNumber,
              barcode: articleNumber,
              batchId,
              bookedAt:
                FieldValue.serverTimestamp(),
              response:
                apiArticle
            },

            updatedAt:
              FieldValue.serverTimestamp()

          });


          results.push({
            orderId: item.orderId,
            shopifyOrderId:
              item.orderData.shopifyOrderId,
            status: 'BOOKED',
            articleNumber,
            barcode: articleNumber
          });

          bookedCount++;

        } catch (error) {

          results.push({
            orderId: item.orderId,
            shopifyOrderId:
              item.orderData.shopifyOrderId,
            status: 'FAILED',
            articleNumber,
            error:
              `Booking response received but Firestore update failed: ${error.message}`
          });

          failedCount++;
        }
      }


      return res.status(200).json({
        success: true,
        batchId,
        message:
          'India Post BBD01 processing completed.',
        summary: {
          total: orderIds.length,
          booked: bookedCount,
          failed: failedCount,
          skipped: skippedCount
        },
        results
      });

    } catch (error) {

      console.error(
        '❌ India Post booking route error:',
        error
      );

      return res.status(500).json({
        success: false,
        batchId,
        message:
          error.message ||
          'Internal server error.'
      });
    }
  }
);
function generateBatchId() {

  const date =
    new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

  const random =
    Math.floor(
      1000 + Math.random() * 9000
    );

  return `ATWOK-${date}-${random}`;
}


// ============================================================
// FIREBASE ORDER UPSERT
// ============================================================

async function saveOrUpdateOrder(newOrder) {

  const ordersRef =
    db.collection('orders');

  const snapshot =
    await ordersRef
      .where(
        'shopifyOrderId',
        '==',
        newOrder.shopifyOrderId
      )
      .get();

  if (!snapshot.empty) {

    const existingDocId =
      snapshot.docs[0].id;

    // IMPORTANT:
    // Don't overwrite the existing indiaPost object.
    // Shopify webhook updates should not destroy booking data.

    await ordersRef
      .doc(existingDocId)
      .update({
        customerName:
          newOrder.customerName,

        phone:
          newOrder.phone,

        address:
          newOrder.address,

        receiverAddress1:
          newOrder.receiverAddress1 || '',

        receiverAddress2:
          newOrder.receiverAddress2 || '',

        receiverCity:
          newOrder.receiverCity || '',

        receiverState:
          newOrder.receiverState || '',

        receiverPincode:
          newOrder.receiverPincode || '',

        product:
          newOrder.product,

        amount:
          newOrder.amount,

        paymentMode:
          newOrder.paymentMode,

        createdAt:
          newOrder.createdAt,

        status:
          newOrder.status,

        remarks:
          newOrder.remarks
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

app.get(
  '/api/sync-last-order',
  (req, res) => {

    console.log(
      '🔄 Manual Sync Ping Received from Frontend!'
    );

    return res.status(200).json({
      success: true,
      message:
        'Backend awake and listening for orders!'
    });
  }
);


// ============================================================
// INDIA POST BULK BOOKING
// BBD01
// ============================================================

app.post(
  '/api/india-post/book',
  async (req, res) => {

    const batchId =
      generateBatchId();

    try {

      const { orderIds } =
        req.body;

      if (
        !Array.isArray(orderIds) ||
        orderIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'No order IDs provided.'
        });
      }


      // Prevent extremely large accidental requests.
      if (orderIds.length > 5000) {
        return res.status(400).json({
          success: false,
          message:
            'Maximum 5,000 orders can be submitted in one BBD01 batch.'
        });
      }


      const ordersRef =
        db.collection('orders');

      const results = [];

      const validArticlesForApi = [];


      let bookedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;


      // ======================================================
      // FETCH + VALIDATE + LOCK
      // ======================================================

      for (
        const orderId of orderIds
      ) {

        const docRef =
          ordersRef.doc(orderId);

        const docSnap =
          await docRef.get();


        if (!docSnap.exists) {

          results.push({
            orderId,
            status: 'SKIPPED',
            error:
              'Order not found in Firestore'
          });

          skippedCount++;

          continue;
        }


        const orderData =
          docSnap.data();


        const existingStatus =
          orderData.indiaPost?.status ||
          'NOT_BOOKED';


        // ----------------------------------------------------
        // Already booked
        // ----------------------------------------------------

        if (
          existingStatus === 'BOOKED'
        ) {

          results.push({
            orderId,
            shopifyOrderId:
              orderData.shopifyOrderId,
            status: 'SKIPPED',
            error:
              'Already booked with India Post',
            articleNumber:
              orderData.indiaPost?.articleNumber ||
              '',
            barcode:
              orderData.indiaPost?.barcode ||
              ''
          });

          skippedCount++;

          continue;
        }
                // ----------------------------------------------------
        // Already being booked
        // ----------------------------------------------------

        if (
          existingStatus === 'BOOKING'
        ) {

          results.push({
            orderId,
            shopifyOrderId:
              orderData.shopifyOrderId,
            status: 'SKIPPED',
            error:
              'This order is already being processed by India Post'
          });

          skippedCount++;

          continue;
        }


        // ----------------------------------------------------
        // Validate
        // ----------------------------------------------------

        const validation =
          validateIndiaPostOrder(
            orderData
          );


        if (!validation.valid) {

          await docRef.update({

            'indiaPost.status':
              'FAILED',

            'indiaPost.batchId':
              batchId,

            'indiaPost.errorMessage':
              validation.errors.join('; ')

          });


          results.push({

            orderId,

            shopifyOrderId:
              orderData.shopifyOrderId,

            status:
              'FAILED',

            error:
              validation.errors.join('; ')

          });


          failedCount++;

          continue;
        }


        // ----------------------------------------------------
        // Lock as BOOKING
        // ----------------------------------------------------

        await docRef.update({

          'indiaPost.status':
            'BOOKING',

          'indiaPost.batchId':
            batchId,

          'indiaPost.errorMessage':
            ''

        });


        const {
          phone,
          receiver,
          barcode,
          isPrepaid
        } = validation.sanitized;


        const amount =
          Number(
            orderData.amount || 0
          );


        // ====================================================
        // BBD01 ARTICLE
        // ====================================================

        const article = {

          bulk_customer_id:
            Number(
              INDIA_POST_CUSTOMER_ID
            ),

          contract_id:
            Number(
              INDIA_POST_CONTRACT_ID
            ),


          // IMPORTANT:
          // We use a real barcode already assigned
          // to the order. We do not invent one.
          barcode_no:
            barcode,


          pickup_or_dropoff:
            'DROPOFF',


          pickup_dropoff_office_id:
            Number(
              INDIA_POST_OFFICE_ID
            ),


          article_type:
            INDIA_POST_ARTICLE_TYPE,


          physical_weight:
            INDIA_POST_PHYSICAL_WEIGHT,


          shape_of_article:
            'NROL',


          length:
            INDIA_POST_LENGTH,

          breadth_diameter:
            INDIA_POST_BREADTH,

          height:
            INDIA_POST_HEIGHT,


          priority_flag:
            true,


          delivery_instruction:
            'ND',


          delivery_slot:
            '9am-2pm',


          instruction_rts:
            'RTS',


          // ==================================================
          // SENDER
          // ==================================================

          sender_name:
            INDIA_POST_SENDER_NAME,

          sender_company:
            INDIA_POST_SENDER_COMPANY,

          sender_add_line_1:
            INDIA_POST_SENDER_ADDRESS_1,

          sender_add_line_2:
            INDIA_POST_SENDER_ADDRESS_2,

          sender_city:
            INDIA_POST_SENDER_CITY,

          sender_state:
            INDIA_POST_SENDER_STATE,

          sender_pincode:
            INDIA_POST_SENDER_PINCODE,

          sender_emailid:
            INDIA_POST_SENDER_EMAIL,

          sender_alt_contact:
            INDIA_POST_SENDER_MOBILE,

          sender_kyc:
            '',

          sender_tax_reference:
            '',

          sender_mobile_no:
            INDIA_POST_SENDER_MOBILE,


          // ==================================================
          // RECEIVER
          // ==================================================

          receiver_name:
            orderData.customerName,

          receiver_company:
            '',

          receiver_add_line_1:
            receiver.line1,

          receiver_add_line_2:
            receiver.line2,

          receiver_city:
            receiver.city,

          receiver_state:
            receiver.state,

          receiver_pincode:
            receiver.pincode,

          receiver_emailid:
            orderData.email || '',

          receiver_alt_contact:
            '',

          receiver_kyc:
            '',

          receiver_tax_reference:
            '',

          receiver_mobile_no:
            phone,


          // ==================================================
          // ADDRESS FLAGS
          // ==================================================

          alt_address_flag:
            false,

          pickup_address_flag:
            false,

          drop_off_pincode:
            INDIA_POST_SENDER_PINCODE,


          // ==================================================
          // PAYMENT
          // ==================================================

          prepayment_code:
            isPrepaid
              ? 'PREPAID'
              : '',

          value_of_prepayment:
            isPrepaid
              ? amount
              : null,

          codr_cod:
            isPrepaid
              ? 'PREPAID'
              : 'COD',

          value_for_codr_cod:
            isPrepaid
              ? 0
              : amount,


          // ==================================================
          // OTHER
          // ==================================================

          insurance_type:
            '',

          value_of_insurance:
            null,

          ack:
            false,

          reg:
            true,

          otp:
            false,

          bulk_reference:
            batchId

        };


        validArticlesForApi.push({

          internalId:
            orderId,

          shopifyOrderId:
            orderData.shopifyOrderId ||
            orderId,

          barcode,

          payload:
            article

        });

      }


      // ======================================================
      // NOTHING TO BOOK
      // ======================================================

      if (
        validArticlesForApi.length === 0
      ) {

        return res.status(200).json({
                  success: true,

          batchId,

          total:
            orderIds.length,

          booked:
            0,

          failed:
            failedCount,

          skipped:
            skippedCount,

          results

        });
      }


      // ======================================================
      // SEND BBD01 REQUEST
      // ======================================================

      const apiPayload = {

        articles:
          validArticlesForApi.map(
            item => item.payload
          )

      };


      console.log(
        `📦 Sending ${validArticlesForApi.length} articles to India Post BBD01...`
      );


      let response;


      try {

        response =
          await makeIndiaPostRequest({

            method:
              'POST',

            url:
              `${INDIA_POST_BOOKING_URL}/${INDIA_POST_CUSTOMER_ID}`,

            headers: {

              accept:
                'application/json',

              'Content-Type':
                'application/json'

            },

            data:
              apiPayload,

            timeout:
              60000

          });

      } catch (apiError) {

        console.error(
          '❌ India Post BBD01 API Error:',
          apiError?.response?.data ||
          apiError.message
        );


        const errorMessage =
          apiError?.response?.data?.message ||
          apiError?.response?.data?.error ||
          apiError.message ||
          'India Post API communication failed';


        // Mark all submitted articles as failed.
        for (
          const item of validArticlesForApi
        ) {

          const docRef =
            ordersRef.doc(
              item.internalId
            );

          await docRef.update({

            'indiaPost.status':
              'FAILED',

            'indiaPost.errorMessage':
              errorMessage

          });


          results.push({

            orderId:
              item.internalId,

            shopifyOrderId:
              item.shopifyOrderId,

            status:
              'FAILED',

            error:
              errorMessage

          });


          failedCount++;
        }


        return res.status(502).json({

          success:
            false,

          batchId,

          total:
            orderIds.length,

          booked:
            bookedCount,

          failed:
            failedCount,

          skipped:
            skippedCount,

          results,

          message:
            'India Post booking API failed.'

        });
      }


      // ======================================================
      // PROCESS ACTUAL BBD01 RESPONSE
      // ======================================================

      const responseData =
        response.data || {};


      console.log(
        '📥 India Post BBD01 response:',
        JSON.stringify(
          responseData,
          null,
          2
        )
      );


      const validArticles =
        Array.isArray(
          responseData.valid_articles
        )
          ? responseData.valid_articles
          : [];


      const errorArticles =
        Array.isArray(
          responseData.error_articles
        )
          ? responseData.error_articles
          : [];


      const responseBatchId =
        responseData.batch_id ||
        batchId;


      const correlationId =
        responseData.correlation_id ||
        '';


      const mailBookingDomId =
        responseData.mail_booking_dom_id ||
        null;


      // ======================================================
      // SUCCESSFUL ARTICLES
      // ======================================================

      for (
        const validArticle of validArticles
      ) {

        const index =
          Number(
            validArticle.index
          );


        const item =
          validArticlesForApi[index];


        if (!item) {

          console.warn(
            '⚠️ India Post returned a valid article with unknown index:',
            validArticle
          );

          continue;
        }


        const barcode =
          validArticle.barcode_no ||
          item.barcode;


        if (!barcode) {

          const docRef =
            ordersRef.doc(
              item.internalId
            );

          await docRef.update({

            'indiaPost.status':
              'FAILED',

            'indiaPost.errorMessage':
              'India Post success response did not contain barcode number.'

          });


          results.push({

            orderId:
              item.internalId,

            shopifyOrderId:
              item.shopifyOrderId,

            status:
              'FAILED',

            error:
              'India Post success response did not contain barcode number.'

          });


          failedCount++;

          continue;
        }


        const docRef =
          ordersRef.doc(
            item.internalId
          );


        // IMPORTANT:
        // BBD01 response provides barcode_no,
        // not a separate article_number.
        //
        // Therefore articleNumber is set to the same
        // barcode value for our label/display system.
        //
        // We are NOT generating a fake article number.

        await docRef.update({

          'indiaPost.status':
            'BOOKED',

          'indiaPost.articleNumber':
            barcode,

          'indiaPost.barcode':
            barcode,

          'indiaPost.bookingReference':
            responseBatchId,

          'indiaPost.batchId':
            responseBatchId,

          'indiaPost.mailBookingDomId':
            mailBookingDomId,

          'indiaPost.correlationId':
            correlationId,

          'indiaPost.calculatedTariff':
            validArticle.calculated_tariff ?? null,

          'indiaPost.currency':
            validArticle.currency || 'INR',

          'indiaPost.bookedAt':
            FieldValue.serverTimestamp(),

          'indiaPost.errorMessage':
            ''

        });


        results.push({

          orderId:
            item.internalId,

          shopifyOrderId:
            item.shopifyOrderId,

          status:
            'BOOKED',

          articleNumber:
            barcode,
                    barcode:
            barcode,

          calculatedTariff:
            validArticle.calculated_tariff ?? null

        });


        bookedCount++;
      }


      // ======================================================
      // FAILED ARTICLES
      // ======================================================

      for (
        const errorArticle of errorArticles
      ) {

        const index =
          Number(
            errorArticle.index
          );


        const item =
          validArticlesForApi[index];


        if (!item) {

          console.warn(
            '⚠️ India Post returned an error article with unknown index:',
            errorArticle
          );

          continue;
        }


        const errorMessage =
          Array.isArray(
            errorArticle.errors
          )
            ? errorArticle.errors.join('; ')
            : (
                errorArticle.error ||
                errorArticle.message ||
                'India Post rejected article'
              );


        const docRef =
          ordersRef.doc(
            item.internalId
          );


        await docRef.update({

          'indiaPost.status':
            'FAILED',

          'indiaPost.batchId':
            responseBatchId,

          'indiaPost.errorMessage':
            errorMessage

        });


        results.push({

          orderId:
            item.internalId,

          shopifyOrderId:
            item.shopifyOrderId,

          status:
            'FAILED',

          barcode:
            errorArticle.barcode_no ||
            item.barcode,

          error:
            errorMessage

        });


        failedCount++;
      }


      // ======================================================
      // SAFETY CHECK
      // ======================================================

      // If India Post says an article was processed but
      // neither valid_articles nor error_articles contains it,
      // don't leave it permanently stuck in BOOKING.

      const processedIndexes =
        new Set([
          ...validArticles.map(
            item => Number(item.index)
          ),
          ...errorArticles.map(
            item => Number(item.index)
          )
        ]);


      for (
        let index = 0;
        index < validArticlesForApi.length;
        index++
      ) {

        if (
          processedIndexes.has(index)
        ) {
          continue;
        }


        const item =
          validArticlesForApi[index];


        const docRef =
          ordersRef.doc(
            item.internalId
          );


        const message =
          'India Post response did not contain a result for this article.';


        await docRef.update({

          'indiaPost.status':
            'FAILED',

          'indiaPost.batchId':
            responseBatchId,

          'indiaPost.errorMessage':
            message

        });


        results.push({

          orderId:
            item.internalId,

          shopifyOrderId:
            item.shopifyOrderId,

          status:
            'FAILED',

          error:
            message

        });


        failedCount++;
      }


      // ======================================================
      // FINAL RESPONSE TO APP.JSX
      // ======================================================

      return res.status(200).json({

        success:
          true,

        batchId:
          responseBatchId,

        correlationId,

        mailBookingDomId,

        total:
          orderIds.length,

        submitted:
          validArticlesForApi.length,

        booked:
          bookedCount,

        failed:
          failedCount,

        skipped:
          skippedCount,

        indiaPostSummary:
          responseData.summary || null,

        results

      });


    } catch (error) {

      console.error(
        '❌ India Post Booking Route Error:',
        error
      );


      return res.status(500).json({

        success:
          false,

        batchId,

        message:
          error.message ||
          'Internal Server Error'

      });
    }
  }
);


// ============================================================
// SHOPIFY WEBHOOK
// ============================================================

app.post(
  '/api/shopify-webhook',
  async (req, res) => {

    try {

      const order =
        req.body;


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


      const fullAddress =
        addressParts.join(', ');


      // ======================================================
      // PRODUCT
      // ======================================================

      let productTitle =
        'Shopify Item';


      if (
        order.line_items &&
        order.line_items.length > 0
      ) {

            ) {

        const item =
          order.line_items[0];


        productTitle =
          item.title ||
          item.name ||
          item.sku ||
          'Shopify Item';
      }


      // ======================================================
      // PHONE
      // ======================================================

      const mainPhone =
        shipping.phone ||
        order.phone ||
        order.billing_address?.phone ||
        '';


      let extraPhone =
        '';


      if (
        Array.isArray(
          order.note_attributes
        ) &&
        order.note_attributes.length > 0
      ) {

        const extraPhoneAttribute =
          order.note_attributes.find(
            attr => {

              const name =
                String(
                  attr.name || ''
                ).toLowerCase();

              return (
                name.includes('phone') ||
                name.includes('mobile') ||
                name.includes('extra')
              );
            }
          );


        if (
          extraPhoneAttribute
        ) {

          extraPhone =
            extraPhoneAttribute.value;
        }
      }


      let displayPhone =
        mainPhone;


      if (
        extraPhone &&
        extraPhone !== mainPhone
      ) {

        displayPhone =
          `${mainPhone} / ${extraPhone}`;
      }


      // ======================================================
      // PAYMENT MODE
      // ======================================================

      // Keep existing ATWOK behavior:
      // COD by default.
      //
      // The user can edit paymentMode before booking.
      const paymentMode =
        'COD';


      // ======================================================
      // SHOPIFY TIME
      // ======================================================

      const exactShopifyTime =
        order.created_at ||
        new Date().toISOString();


      // ======================================================
      // CUSTOMER NAME
      // ======================================================

      const customerName =

        `${shipping.first_name || ''} ${shipping.last_name || ''}`
          .trim()

        ||

        order.customer?.first_name

        ||

        'Guest Customer';


      // ======================================================
      // FIREBASE ORDER
      // ======================================================

      const newOrder = {

        shopifyOrderId:
          order.name ||
          `#${order.order_number}`,

        customerName,

        phone:
          displayPhone,

        address:
          fullAddress,


        // Structured receiver address
        receiverAddress1:
          shipping.address1 || '',

        receiverAddress2:
          shipping.address2 || '',

        receiverCity:
          shipping.city || '',

        receiverState:
          shipping.province || '',

        receiverPincode:
          shipping.zip || '',


        email:
          order.email ||
          order.customer?.email ||
          '',


        product:
          productTitle,

        amount:
          String(
            order.total_price || '0'
          ),

        paymentMode,

        createdAt:
          exactShopifyTime,

        status:
          'Pending',

        remarks:
          '',


        // India Post initial state
        indiaPost: {

          status:
            'NOT_BOOKED',

          articleNumber:
            '',

          barcode:
            '',

          bookingReference:
            '',

          batchId:
            '',

          mailBookingDomId:
            null,

          correlationId:
            '',

          calculatedTariff:
            null,

          currency:
            'INR',

          bookedAt:
            null,

          errorMessage:
            ''

        }

      };


      await saveOrUpdateOrder(
        newOrder
      );


      console.log(
        `⚡ Shopify Webhook Success: ${newOrder.shopifyOrderId}`
      );


      return res
        .status(200)
        .send(
          'Webhook Processed Successfully'
        );


    } catch (error) {

      console.error(
        '❌ Shopify webhook error:',
        error
      );


      return res
        .status(500)
        .send(
          'Webhook Handler Failed'
        );
    }
  }
);


// ============================================================
// WHATSAPP CRM CONFIGURATION
// ============================================================

const WACRM_API_BASE_URL =
  'https://api-whatsapp.wacrmpro.in';

const WACRM_API_TOKEN =
  process.env.WACRM_API_TOKEN || '';

const WACRM_TEST_API_KEY =
  process.env.WACRM_TEST_API_KEY || '';

function normalizeWhatsAppPhone(phone) {
  // Use the first phone when an order stores multiple numbers.
  const firstPhone = String(phone || '').split(/[\\/,;|]+/)[0].trim();
  let value = firstPhone.replace(/\\D/g, '');

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
// WHATSAPP HUB — ORDER LOOKUP + BULK CONFIRMATION
// ============================================================

// IMPORTANT:
// These routes are protected by WACRM_TEST_API_KEY for server-side testing.
// Do NOT place this key in App.jsx or any browser code.

function requireWhatsAppHubKey(req, res, next) {
  if (!WACRM_TEST_API_KEY) {
    return res.status(503).json({
      success: false,
      message: 'WhatsApp Hub API key is not configured on the server.'
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

  return next();
}

function normalizeShopifyOrderId(value) {
  return String(value || '').trim();
}

function buildWhatsAppConfirmationMessage(order, template) {
  const customerName = String(order.customerName || 'Customer').trim();
  const productName = String(order.product || order.productName || 'your order').trim();
  const amountRaw = String(order.amount ?? order.price ?? '0').replace(/[₹,\s]/g, '');
  const amount = Number(amountRaw);
  const price = Number.isFinite(amount)
    ? amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : String(order.amount ?? order.price ?? '0');

  return String(template)
    .replace(/{name}/g, customerName)
    .replace(/{product}/g, productName)
    .replace(/{price}/g, price);
}

function getWhatsAppOrderPhone(order) {
  // The order may contain a primary and secondary phone separated by / or ,.
  const firstPhone = String(order.phone || order.mobile || '')
    .split(/[\/,;|]+/)[0]
    .trim();

  return normalizeWhatsAppPhone(firstPhone);
}

// Fetch Shopify orders by their Shopify order IDs.
// POST /api/whatsapp/orders/lookup
// Body: { "orderIds": ["#1001", "#1002"] }
app.post(
  '/api/whatsapp/orders/lookup',
  requireWhatsAppHubKey,
  async (req, res) => {
    try {
      const rawOrderIds = req.body?.orderIds;

      if (!Array.isArray(rawOrderIds) || rawOrderIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide at least one Shopify order ID.'
        });
      }

      const orderIds = [...new Set(
        rawOrderIds.map(normalizeShopifyOrderId).filter(Boolean)
      )];

      if (orderIds.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'A maximum of 100 order IDs can be fetched at once.'
        });
      }

      const ordersRef = db.collection('orders');
      const foundById = new Map();

      // Firestore "in" queries support up to 30 values. Query in chunks.
      for (let i = 0; i < orderIds.length; i += 30) {
        const chunk = orderIds.slice(i, i + 30);
        const snapshot = await ordersRef
          .where('shopifyOrderId', 'in', chunk)
          .get();

        snapshot.forEach(docSnap => {
          const data = docSnap.data() || {};
          const shopifyOrderId = normalizeShopifyOrderId(data.shopifyOrderId);

          foundById.set(shopifyOrderId, {
            id: docSnap.id,
            shopifyOrderId,
            customerName: data.customerName || '',
            phone: data.phone || '',
            product: data.product || data.productName || '',
            amount: data.amount ?? data.price ?? '',
            createdAt: data.createdAt || data.created_at || null
          });
        });
      }

      const foundOrders = orderIds
        .map(id => foundById.get(id))
        .filter(Boolean);

      const notFound = orderIds.filter(id => !foundById.has(id));

      return res.json({
        success: true,
        requested: orderIds.length,
        found: foundOrders.length,
        notFound,
        orders: foundOrders
      });
    } catch (error) {
      console.error(
        'WhatsApp Hub order lookup error:',
        error?.message || error
      );

      return res.status(500).json({
        success: false,
        message: 'Unable to fetch the requested orders.'
      });
    }
  }
);

// Send personalised WhatsApp confirmation messages in sequence.
// POST /api/whatsapp/orders/send-bulk
// Body: { "orderIds": ["#1001"], "template": "Hello {name}..." }
app.post(
  '/api/whatsapp/orders/send-bulk',
  requireWhatsAppHubKey,
  async (req, res) => {
    const rawOrderIds = req.body?.orderIds;
    const template = String(req.body?.template || '').trim();

    if (!Array.isArray(rawOrderIds) || rawOrderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one Shopify order ID.'
      });
    }

    if (rawOrderIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'A maximum of 50 messages can be sent in one batch.'
      });
    }

    if (!template) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp message template is required.'
      });
    }

    const orderIds = [...new Set(
      rawOrderIds.map(normalizeShopifyOrderId).filter(Boolean)
    )];

    const results = [];

    for (const requestedId of orderIds) {
      try {
        const snapshot = await db.collection('orders')
          .where('shopifyOrderId', '==', requestedId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          results.push({
            shopifyOrderId: requestedId,
            status: 'FAILED',
            error: 'Order not found in Firestore.'
          });
          continue;
        }

        const orderDoc = snapshot.docs[0];
        const order = orderDoc.data() || '';

        let phone;
        try {
          phone = getWhatsAppOrderPhone(order);
        } catch (phoneError) {
          results.push({
            shopifyOrderId: requestedId,
            status: 'FAILED',
            error: 'Missing or invalid customer phone number.'
          });
          continue;
        }

        const message = buildWhatsAppConfirmationMessage(order, template);

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
          results.push({
            shopifyOrderId: requestedId,
            status: 'FAILED',
            error: crmResponse.data?.message || 'WhatsApp provider rejected the message.'
          });
          continue;
        }

        // Store the last successful manual confirmation send for visibility/audit.
        await orderDoc.ref.set({
          whatsappConfirmation: {
            lastSentAt: FieldValue.serverTimestamp(),
            lastSentPhone: phone,
            lastMessage: message,
            status: 'SENT'
          }
        }, { merge: true });

        results.push({
          shopifyOrderId: requestedId,
          status: 'SENT',
          customerName: order.customerName || '',
          phone
        });
      } catch (error) {
        console.error(
          `WhatsApp send failed for ${requestedId}:`,
          error?.response?.data || error?.message || error
        );

        results.push({
          shopifyOrderId: requestedId,
          status: 'FAILED',
          error: error?.response?.data?.message ||
            'Unable to send this WhatsApp message.'
        });
      }
    }

    const sent = results.filter(item => item.status === 'SENT').length;
    const failed = results.length - sent;

    return res.json({
      success: failed === 0,
      total: results.length,
      sent,
      failed,
      results
    });
  }
);


// ============================================================
// SERVER START
// ============================================================

const PORT =
  process.env.PORT || 5000;


app.listen(
  PORT,
  () => {

    console.log(
      `🚀 ATWOK Backend running on port ${PORT}`
    );

    console.log(
      `🇮🇳 India Post Base URL: ${INDIA_POST_BASE_URL}`
    );

    console.log(
      `📦 BBD01 endpoint: ${INDIA_POST_BOOKING_URL}/:customerID`
    );

  }
);
