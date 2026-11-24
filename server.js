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
// WHATSAPP CRM CONFIGURATION
// ============================================================

const WACRM_API_BASE_URL =
  'https://api-whatsapp.wacrmpro.in';

const WACRM_API_TOKEN =
  process.env.WACRM_API_TOKEN || '';

const WACRM_TEST_API_KEY =
  process.env.WACRM_TEST_API_KEY || '';

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
// WHATSAPP HUB — SECURE LOGIN, ORDER LOOKUP & MANUAL BULK SEND
// ============================================================

// Keep all secrets in Render Environment Variables. Never put them in App.jsx.
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

app.post('/api/whatsapp/hub/login', (req, res) => {
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

function normalizeHubShopifyOrderId(value) {
  return String(value || '').trim();
}

function getExactWhatsAppProductName(order) {
  if (!order || typeof order !== 'object') return 'your order';

  const isPlaceholder = value =>
    !String(value ?? '').trim() ||
    /^(shopify product|product|ordered item|unnamed product|item|your order)$/i.test(String(value).trim());

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
    return items.map(item => asTitle(item)).filter(Boolean).join(' + ');
  };

  // Prefer the exact Shopify line-item title; generic fields like "your order"
  // must never override the actual product name.
  const candidates = [
    order.originalShopifyProductName,
    order.shopifyProductTitle,
    titlesFrom(order.line_items),
    titlesFrom(order.lineItems),
    titlesFrom(order.items),
    titlesFrom(order.orderItems),
    titlesFrom(order.products),
    order.product,
    order.productName,
    order.product_name,
    order.productTitle,
    order.product_title,
    order.title,
    order.name,
    order.productDetailsSnapshot?.productName,
    order.productDetailsSnapshot?.title
  ];

  for (const candidate of candidates) {
    const title = asTitle(candidate);
    if (title) return title;
  }
  return 'your order';
}

function buildWhatsAppConfirmationMessage(order, template, requestedOrderId = '') {
  const customerName = String(order.customerName || 'Customer').trim();
  const productName = getExactWhatsAppProductName(order);
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

function getWhatsAppOrderPhone(order) {
  return normalizeWhatsAppPhone(order.phone || order.mobile || order.customerPhone || '');
}

// POST /api/whatsapp/tracking/send — automatic dispatch message after
// Label Studio has successfully transferred the selected orders to Tracking.
// Idempotency is stored on each source order and keyed by the tracking ID.
app.post('/api/whatsapp/tracking/send', requireWhatsAppHubSession, async (req, res) => {
  const rawIds = req.body?.orderDocIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return res.status(400).json({ success: false, message: 'Please provide at least one order document ID.' });
  }
  if (rawIds.length > 100) {
    return res.status(400).json({ success: false, message: 'A maximum of 100 orders can be processed at once.' });
  }

  const orderDocIds = [...new Set(rawIds.map(value => String(value || '').trim()).filter(Boolean))];
  const results = [];

  for (const orderDocId of orderDocIds) {
    try {
      const orderRef = db.collection('orders').doc(orderDocId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        results.push({ attemptedAt: new Date().toISOString(), orderDocId, status: 'FAILED', error: 'Source order not found.' });
        continue;
      }

      const order = orderSnap.data() || {};
      const trackingId = String(order.indiaPost?.articleNumber || order.trackingId || '').trim().toUpperCase();
      if (!/^(EL|EY)\d{9,10}IN$/.test(trackingId)) {
        results.push({ attemptedAt: new Date().toISOString(), orderDocId, status: 'FAILED', error: 'A valid allocated India Post tracking ID is missing.' });
        continue;
      }

      const alreadySentTrackingId = String(order.trackingWhatsApp?.lastSentTrackingId || '').trim().toUpperCase();
      if (alreadySentTrackingId === trackingId && order.trackingWhatsApp?.status === 'SENT') {
        results.push({ attemptedAt: new Date().toISOString(), orderDocId, trackingId, status: 'SKIPPED', reason: 'This tracking ID was already notified.' });
        continue;
      }
      if (String(order.trackingWhatsApp?.trackingId || '').trim().toUpperCase() === trackingId && order.trackingWhatsApp?.status === 'SENDING') {
        results.push({ attemptedAt: new Date().toISOString(), orderDocId, trackingId, status: 'SKIPPED', reason: 'A WhatsApp message for this tracking ID is already being sent.' });
        continue;
      }

      let phone;
      try {
        phone = getWhatsAppOrderPhone(order);
      } catch {
        results.push({ attemptedAt: new Date().toISOString(), orderDocId, trackingId, status: 'FAILED', error: 'Missing or invalid customer phone number.' });
        continue;
      }

      const customerName = String(order.customerName || order.name || 'Customer').trim();
      const productName = getExactWhatsAppProductName(order);
      const amountRaw = order.amount ?? order.sellingPrice ?? order.totalPrice ?? order.price ?? '';
      const amountNumber = Number(String(amountRaw).replace(/[₹,\s]/g, ''));
      const amount = Number.isFinite(amountNumber)
        ? `₹${amountNumber.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
        : String(amountRaw || 'Not available');
      const paymentMode = String(order.paymentMode || (order.isPrepaid ? 'Prepaid' : 'COD')).trim();
      const trackingLink = `https://speedpost.live/track?n=${encodeURIComponent(trackingId)}`;
      const message = [
        '📦 ATWOK – ORDER DISPATCH UPDATE',
        '',
        `Hello ${customerName}! 👋`,
        '',
        'Your order has been dispatched!',
        '',
        `Product: ${productName}`,
        `Amount: ${amount}`,
        `Payment Mode: ${paymentMode}`,
        '',
        '🚚 Your product will be delivered within 2–3 days through India Post.',
        '',
        '📍 Track Your Order Live:',
        trackingLink,
        '',
        'Thank you for choosing ATWOK! ❤️',
        '– Team ATWOK'
      ].join('\n');

      // Mark as SENDING first to reduce duplicate sends from concurrent clicks.
      await orderRef.set({
        trackingWhatsApp: {
          status: 'SENDING',
          trackingId,
          startedAt: FieldValue.serverTimestamp()
        }
      }, { merge: true });

      const crmResponse = await axios.post(
        `${WACRM_API_BASE_URL}/api/enviar-texto/${encodeURIComponent(WACRM_API_TOKEN)}`,
        { phone, message },
        {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 30000
        }
      );

      if (crmResponse.data?.success !== true) {
        throw new Error(crmResponse.data?.message || 'WhatsApp provider rejected the message.');
      }

      await orderRef.set({
        trackingWhatsApp: {
          status: 'SENT',
          trackingId,
          lastSentTrackingId: trackingId,
          lastSentAt: FieldValue.serverTimestamp(),
          lastSentPhone: phone,
          lastMessage: message,
          error: ''
        }
      }, { merge: true });
      results.push({ attemptedAt: new Date().toISOString(), orderDocId, trackingId, status: 'SENT', customerName, phone });
    } catch (error) {
      console.error(`Tracking WhatsApp send failed for ${orderDocId}:`, error?.response?.data || error?.message || error);
      try {
        await db.collection('orders').doc(orderDocId).set({
          trackingWhatsApp: {
            status: 'FAILED',
            error: String(error?.response?.data?.message || error?.message || 'WhatsApp send failed').slice(0, 500),
            failedAt: FieldValue.serverTimestamp()
          }
        }, { merge: true });
      } catch (saveError) {
        console.error(`Could not save tracking WhatsApp failure for ${orderDocId}:`, saveError?.message || saveError);
      }
      results.push({ attemptedAt: new Date().toISOString(), orderDocId, status: 'FAILED', error: error?.response?.data?.message || error?.message || 'WhatsApp send failed.' });
    }
  }

  // Persist an auditable record for every tracking-send attempt, including
  // rejected/failed and duplicate-skipped outcomes.
  for (const result of results) {
    try {
      const sourceSnap = result.orderDocId
        ? await db.collection('orders').doc(result.orderDocId).get()
        : null;
      const sourceOrder = sourceSnap?.exists ? (sourceSnap.data() || {}) : {};
      const createdAt = FieldValue.serverTimestamp();
      await db.collection('whatsappTrackingLogs').add({
        orderDocId: result.orderDocId || '',
        trackingId: result.trackingId || sourceOrder.indiaPost?.articleNumber || sourceOrder.trackingId || '',
        customerName: result.customerName || sourceOrder.customerName || sourceOrder.name || 'Customer',
        phone: result.phone || sourceOrder.phone || sourceOrder.mobile || '',
        status: result.status || 'FAILED',
        error: result.error || result.reason || '',
        createdAt: result.attemptedAt ? new Date(result.attemptedAt) : createdAt,
        channel: 'TRACKING_DISPATCH'
      });
    } catch (logError) {
      console.error('Could not save WhatsApp tracking history:', logError?.message || logError);
    }
  }

  const sentCount = results.filter(item => item.status === 'SENT').length;
  const skippedCount = results.filter(item => item.status === 'SKIPPED').length;
  const failedCount = results.filter(item => item.status === 'FAILED').length;
  return res.json({ success: true, requested: orderDocIds.length, sentCount, skippedCount, failedCount, results });
});

// GET /api/whatsapp/tracking/history — recent tracking dispatch WhatsApp attempts.
app.get('/api/whatsapp/tracking/history', requireWhatsAppHubSession, async (req, res) => {
  try {
    const requestedLimit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    const snapshot = await db.collection('whatsappTrackingLogs')
      .orderBy('createdAt', 'desc')
      .limit(requestedLimit)
      .get();
    const logs = snapshot.docs.map(docSnap => {
      const data = docSnap.data() || {};
      const createdAt = data.createdAt?.toDate
        ? data.createdAt.toDate().toISOString()
        : (data.createdAt instanceof Date ? data.createdAt.toISOString() : null);
      return { id: docSnap.id, ...data, createdAt };
    });
    return res.json({ success: true, total: logs.length, logs });
  } catch (error) {
    console.error('WhatsApp tracking history error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load tracking WhatsApp history.' });
  }
});

// POST /api/whatsapp/orders/lookup — preview matching Firestore orders.
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

    const ordersRef = db.collection('orders');
    const foundById = new Map();
    for (let i = 0; i < orderIds.length; i += 30) {
      const chunk = orderIds.slice(i, i + 30);
      const snapshot = await ordersRef.where('shopifyOrderId', 'in', chunk).get();
      snapshot.forEach(docSnap => {
        const data = docSnap.data() || {};
        const shopifyOrderId = normalizeHubShopifyOrderId(data.shopifyOrderId);
        foundById.set(shopifyOrderId, {
          id: docSnap.id,
          shopifyOrderId,
          customerName: data.customerName || '',
          phone: data.phone || '',
          product: getExactWhatsAppProductName(data),
          amount: data.amount ?? data.price ?? '',
          createdAt: data.createdAt || data.created_at || null
        });
      });
    }

    const orders = orderIds.map(id => foundById.get(id)).filter(Boolean);
    const notFound = orderIds.filter(id => !foundById.has(id));
    return res.json({ success: true, requested: orderIds.length, found: orders.length, notFound, orders });
  } catch (error) {
    console.error('WhatsApp Hub order lookup error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to fetch the requested orders.' });
  }
});

// POST /api/whatsapp/orders/send-bulk — manual sends only, one by one.
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
  const results = [];

  for (const requestedId of orderIds) {
    try {
      const snapshot = await db.collection('orders')
        .where('shopifyOrderId', '==', requestedId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        results.push({ shopifyOrderId: requestedId, status: 'FAILED', error: 'Order not found in Firestore.' });
        continue;
      }

      const orderDoc = snapshot.docs[0];
      const order = orderDoc.data() || {};
      let phone;
      try {
        phone = getWhatsAppOrderPhone(order);
      } catch {
        results.push({ shopifyOrderId: requestedId, status: 'FAILED', error: 'Missing or invalid customer phone number.' });
        continue;
      }

      const message = buildWhatsAppConfirmationMessage(order, template, requestedId);
      const crmResponse = await axios.post(
        `${WACRM_API_BASE_URL}/api/enviar-texto/${encodeURIComponent(WACRM_API_TOKEN)}`,
        { phone, message },
        {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

      await orderDoc.ref.set({
        whatsappConfirmation: {
          lastSentAt: FieldValue.serverTimestamp(),
          lastSentPhone: phone,
          lastMessage: message,
          status: 'SENT'
        }
      }, { merge: true });

      results.push({ shopifyOrderId: requestedId, status: 'SENT', customerName: order.customerName || '', phone });
    } catch (error) {
      console.error(`WhatsApp send failed for ${requestedId}:`, error?.response?.data || error?.message || error);
      results.push({
        shopifyOrderId: requestedId,
        status: 'FAILED',
        error: error?.response?.data?.message || 'Unable to send this WhatsApp message.'
      });
    }
  }

  const sent = results.filter(item => item.status === 'SENT').length;
  const failed = results.length - sent;
  // success means the batch request was processed; individual outcomes are in results.
  return res.json({ success: true, total: results.length, sent, failed, results });
});


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
