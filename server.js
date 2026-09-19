const express = require('express');
const cors = require('cors');
const axios = require('axios');

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

app.use(cors());
app.use(express.json());


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
// INDIA POST CONFIGURATION
// ============================================================

// Sandbox by default.
// Change INDIA_POST_BASE_URL in Render when moving to production.
const INDIA_POST_BASE_URL =
  process.env.INDIA_POST_BASE_URL ||
  'https://test.cept.gov.in';


// Exact India Post authentication endpoints confirmed
const INDIA_POST_LOGIN_URL =
  `${INDIA_POST_BASE_URL}/beextcustomer/v1/access/login`;

const INDIA_POST_REFRESH_URL =
  `${INDIA_POST_BASE_URL}/beextcustomer/v1/access/TokenWithRtoken`;


// BBD01
const INDIA_POST_BOOKING_URL =
  `${INDIA_POST_BASE_URL}/beextcustomer/process-articles-file`;


// Credentials MUST be stored in Render Environment Variables
const INDIA_POST_USERNAME =
  process.env.INDIA_POST_USERNAME || '';

const INDIA_POST_PASSWORD =
  process.env.INDIA_POST_PASSWORD || '';


// Your actual customer/contract/office IDs should be stored
// in Render Environment Variables.
const INDIA_POST_CUSTOMER_ID =
  process.env.INDIA_POST_CUSTOMER_ID || '';

const INDIA_POST_CONTRACT_ID =
  process.env.INDIA_POST_CONTRACT_ID || '';

const INDIA_POST_OFFICE_ID =
  process.env.INDIA_POST_OFFICE_ID || '';


// Sender information
const INDIA_POST_SENDER_NAME =
  process.env.INDIA_POST_SENDER_NAME || 'ATWOK';

const INDIA_POST_SENDER_COMPANY =
  process.env.INDIA_POST_SENDER_COMPANY || 'ATWOK STORE';

const INDIA_POST_SENDER_ADDRESS_1 =
  process.env.INDIA_POST_SENDER_ADDRESS_1 || '';

const INDIA_POST_SENDER_ADDRESS_2 =
  process.env.INDIA_POST_SENDER_ADDRESS_2 || '';

const INDIA_POST_SENDER_CITY =
  process.env.INDIA_POST_SENDER_CITY || 'Kozhikode';

const INDIA_POST_SENDER_STATE =
  process.env.INDIA_POST_SENDER_STATE || 'Kerala';

const INDIA_POST_SENDER_PINCODE =
  process.env.INDIA_POST_SENDER_PINCODE || '';

const INDIA_POST_SENDER_EMAIL =
  process.env.INDIA_POST_SENDER_EMAIL || '';

const INDIA_POST_SENDER_MOBILE =
  process.env.INDIA_POST_SENDER_MOBILE || '';


// Default article details.
// Change these according to your actual India Post contract/API requirements.
const INDIA_POST_ARTICLE_TYPE =
  process.env.INDIA_POST_ARTICLE_TYPE || 'SP';

const INDIA_POST_PHYSICAL_WEIGHT =
  Number(process.env.INDIA_POST_PHYSICAL_WEIGHT || 15);

const INDIA_POST_LENGTH =
  Number(process.env.INDIA_POST_LENGTH || 10);

const INDIA_POST_BREADTH =
  Number(process.env.INDIA_POST_BREADTH || 10);

const INDIA_POST_HEIGHT =
  Number(process.env.INDIA_POST_HEIGHT || 5);


// ============================================================
// INDIA POST TOKEN CACHE
// ============================================================

let indiaPostAccessToken = null;
let indiaPostRefreshToken = null;
let indiaPostTokenExpiresAt = 0;


// ============================================================
// STORE TOKEN DATA
// ============================================================

function storeTokenData(responseData) {

  const data = responseData?.data;

  if (!data || !data.access_token) {
    console.error(
      '❌ India Post authentication response did not contain access_token:',
      responseData
    );

    throw new Error(
      'India Post authentication response did not contain an access token.'
    );
  }

  indiaPostAccessToken = data.access_token;

  indiaPostRefreshToken =
    data.refresh_token || indiaPostRefreshToken || null;

  const expiresInSeconds =
    Number(data.expires_in || 900);

  // Keep a 60-second safety buffer.
  indiaPostTokenExpiresAt =
    Date.now() + ((expiresInSeconds - 60) * 1000);

  console.log(
    `🔐 India Post access token stored. Expires in approximately ${expiresInSeconds} seconds.`
  );
}


// ============================================================
// AUTH01 — CUSTOMER LOGIN
// ============================================================

async function loginToIndiaPost() {

  if (!INDIA_POST_USERNAME || !INDIA_POST_PASSWORD) {
    throw new Error(
      'India Post username/password are missing from Render environment variables.'
    );
  }

  console.log('🔐 India Post AUTH01 login...');

  try {

    const response = await axios.post(
      INDIA_POST_LOGIN_URL,
      {
        username: INDIA_POST_USERNAME,
        password: INDIA_POST_PASSWORD
      },
      {
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    if (!response.data?.success) {
      console.error(
        '❌ India Post AUTH01 unsuccessful:',
        response.data
      );

      throw new Error(
        'India Post AUTH01 login was not successful.'
      );
    }

    storeTokenData(response.data);

    console.log('✅ India Post AUTH01 login successful.');

    return indiaPostAccessToken;

  } catch (error) {

    console.error(
      '❌ India Post AUTH01 error:',
      error?.response?.data || error.message
    );

    throw new Error(
      'India Post authentication failed.'
    );
  }
}


// ============================================================
// AUTH02 — REFRESH ACCESS TOKEN
// ============================================================

async function refreshIndiaPostToken() {

  if (!indiaPostRefreshToken) {
    console.log(
      'ℹ️ No India Post refresh token available. Performing AUTH01 login.'
    );

    return loginToIndiaPost();
  }

  console.log('🔄 India Post AUTH02 token refresh...');

  try {

    const response = await axios.post(
      INDIA_POST_REFRESH_URL,
      null,
      {
        headers: {
          accept: 'application/json',
          Authorization:
            `Bearer ${indiaPostRefreshToken}`
        },
        timeout: 30000
      }
    );

    if (!response.data?.success) {
      console.warn(
        '⚠️ India Post AUTH02 was not successful:',
        response.data
      );

      return loginToIndiaPost();
    }

    storeTokenData(response.data);

    console.log('✅ India Post AUTH02 refresh successful.');

    return indiaPostAccessToken;

  } catch (error) {

    console.warn(
      '⚠️ India Post AUTH02 failed. Falling back to AUTH01:',
      error?.response?.data || error.message
    );

    indiaPostAccessToken = null;
    indiaPostTokenExpiresAt = 0;

    return loginToIndiaPost();
  }
}


// ============================================================
// GET VALID ACCESS TOKEN
// ============================================================

async function getIndiaPostAccessToken() {

  const now = Date.now();

  if (
    indiaPostAccessToken &&
    indiaPostTokenExpiresAt &&
    now < indiaPostTokenExpiresAt
  ) {
    return indiaPostAccessToken;
  }

  if (indiaPostRefreshToken) {
    try {
      return await refreshIndiaPostToken();
    } catch (error) {
      console.warn(
        '⚠️ Refresh failed. Falling back to AUTH01.'
      );
    }
  }

  return loginToIndiaPost();
}


// ============================================================
// INDIA POST REQUEST WRAPPER
// ============================================================

async function makeIndiaPostRequest(
  requestConfig,
  retryCount = 0
) {

  try {

    const token =
      await getIndiaPostAccessToken();

    const finalConfig = {
      ...requestConfig,
      headers: {
        ...(requestConfig.headers || {}),
        Authorization:
          `Bearer ${token}`
      }
    };

    return await axios(finalConfig);

  } catch (error) {

    // If access token expired / invalid,
    // clear token and retry only once.
    if (
      error?.response?.status === 401 &&
      retryCount < 1
    ) {

      console.warn(
        '🔄 India Post returned 401. Clearing token and retrying once...'
      );

      indiaPostAccessToken = null;
      indiaPostTokenExpiresAt = 0;

      return makeIndiaPostRequest(
        requestConfig,
        retryCount + 1
      );
    }

    throw error;
  }
}


// ============================================================
// PHONE CLEANING
// ============================================================

function cleanPhone(phone) {

  if (!phone) {
    return '';
  }

  // Take first number if multiple numbers are stored.
  let value =
    String(phone)
      .split(/[/,]/)[0]
      .trim();

  value =
    value.replace(/^\+91/, '');

  value =
    value.replace(/\D/g, '');

  if (value.length > 10) {
    value = value.slice(-10);
  }

  return value;
}


// ============================================================
// PIN CODE EXTRACTION
// ============================================================

function extractPincode(order) {

  if (order.pinCode) {
    return String(order.pinCode).trim();
  }

  if (order.pincode) {
    return String(order.pincode).trim();
  }

  const address =
    String(order.address || '');

  const matches =
    address.match(/\b[1-9][0-9]{5}\b/g);

  if (matches && matches.length > 0) {
    return matches[matches.length - 1];
  }

  return '';
}


// ============================================================
// ADDRESS PARSER
// ============================================================

function getReceiverAddress(order) {

  const address1 =
    order.receiverAddress1 ||
    order.addressLine1 ||
    '';

  const address2 =
    order.receiverAddress2 ||
    order.addressLine2 ||
    '';

  const city =
    order.receiverCity ||
    order.city ||
    '';

  const state =
    order.receiverState ||
    order.state ||
    '';

  const pincode =
    order.receiverPincode ||
    order.pinCode ||
    order.pincode ||
    extractPincode(order);

  // Fallback for older orders that only have one combined address.
  if (!address1) {

    const parts =
      String(order.address || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);

    return {
      line1: parts[0] || '',
      line2: parts[1] || '',
      city: parts[2] || '',
      state: parts[3] || '',
      pincode:
        pincode ||
        parts.find(x => /^[1-9][0-9]{5}$/.test(x)) ||
        ''
    };
  }

  return {
    line1: address1,
    line2: address2,
    city,
    state,
    pincode
  };
}


// ============================================================
// BARCODE VALIDATION
// ============================================================

function getOrderBarcode(order) {

  // We only use a barcode that already exists.
  // We NEVER generate a random fake India Post barcode.

  const barcode =
    order.indiaPost?.barcode ||
    order.indiaPost?.articleNumber ||
    order.barcode ||
    order.barcodeNo ||
    '';

  return String(barcode).trim();
}


// ============================================================
// INDIA POST ORDER VALIDATION
// ============================================================

function validateIndiaPostOrder(order) {

  const errors = [];

  if (
    !order.customerName ||
    String(order.customerName).trim().length < 2
  ) {
    errors.push(
      'Missing or invalid customer name'
    );
  }

  const phone =
    cleanPhone(order.phone);

  if (!phone || phone.length !== 10) {
    errors.push(
      'Missing or invalid receiver mobile number'
    );
  }

  const receiver =
    getReceiverAddress(order);

  if (
    !receiver.line1 ||
    receiver.line1.trim().length < 3
  ) {
    errors.push(
      'Missing receiver address'
    );
  }

  if (
    !receiver.pincode ||
    !/^[1-9][0-9]{5}$/.test(
      String(receiver.pincode)
    )
  ) {
    errors.push(
      'Receiver PIN code must be exactly 6 digits'
    );
  }

  if (!order.product) {
    errors.push(
      'Missing product information'
    );
  }

  const barcode =
    getOrderBarcode(order);

  if (!barcode) {
    errors.push(
      'No India Post barcode assigned to this order'
    );
  }

  const paymentMode =
    String(order.paymentMode || 'COD')
      .toLowerCase();

  const isPrepaid =
    paymentMode.includes('prepaid') ||
    paymentMode.includes('paid');

  if (!isPrepaid) {

    const amount =
      Number(order.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      errors.push(
        'Invalid COD amount'
      );
    }
  }

  if (
    !INDIA_POST_CUSTOMER_ID
  ) {
    errors.push(
      'India Post customer ID is missing'
    );
  }

  if (
    !INDIA_POST_CONTRACT_ID
  ) {
    errors.push(
      'India Post contract ID is missing'
    );
  }

  if (
    !INDIA_POST_OFFICE_ID
  ) {
    errors.push(
      'India Post office ID is missing'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      phone,
      receiver,
      barcode,
      isPrepaid
    }
  };
}


// ============================================================
// GENERATE INTERNAL BATCH ID
// ============================================================

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
