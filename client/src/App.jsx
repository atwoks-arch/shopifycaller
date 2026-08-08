import React, { useState, useEffect, createContext, useContext } from 'react';
import './App.css';

// --- EMBEDDED FIREBASE SDK MODULES ---
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  serverTimestamp 
} from "firebase/firestore";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";

// --- PROJECT INFRASTRUCTURE ENDPOINTS ---
const firebaseConfig = {
  apiKey: "AIzaSyAdi2OMsmTrqr35lFETPWDrDexx6U3W4a0",
  authDomain: "atwokcaller.firebaseapp.com",
  projectId: "atwokcaller",
  storageBucket: "atwokcaller.firebasestorage.app",
  messagingSenderId: "478069082743",
  appId: "1:478069082743:web:09eedd61384e9ae5b3d472"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const AppContext = createContext();

// ✂️ HELPER ENGINE: Trims product titles down to 3 words for dashboard view
const getShortProductTitle = (fullTitle) => {
  if (!fullTitle || fullTitle === "Shopify Product") return fullTitle || "Shopify Product";
  const cleanBase = fullTitle.split(/[-–|,]/)[0].trim();
  const words = cleanBase.split(' ').filter(Boolean);
  if (words.length > 3) {
    return words.slice(0, 3).join(' ');
  }
  return cleanBase;
};

// ✂️ HELPER ENGINE: Strictly gets ONLY the FIRST 2 WORDS for thermal labels
const getLabelProductTitle = (fullTitle) => {
  if (!fullTitle || fullTitle === "Shopify Product") return fullTitle || "Shopify Product";
  const cleanBase = fullTitle.split(/[-–|,]/)[0].trim();
  const words = cleanBase.split(' ').filter(Boolean);
  return words.slice(0, 2).join(' ');
};

// --- NUMBER TO WORDS HELPER ENGINE ---
const numberToWords = (num) => {
  if (!num || isNaN(num)) return "";
  const a = ['', 'one ', 'two ', 'three ', 'four ', 'five ', 'six ', 'seven ', 'eight ', 'nine ', 'ten ', 'eleven ', 'twelve ', 'thirteen ', 'fourteen ', 'fifteen ', 'sixteen ', 'seventeen ', 'eighteen ', 'nineteen '];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  const makeWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? "-" + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + "hundred " + (n % 100 !== 0 ? "and " + makeWords(n % 100) : "");
    if (n < 100000) return makeWords(Math.floor(n / 1000)) + "thousand " + (n % 1000 !== 0 ? makeWords(n % 1000) : "");
    return "";
  };
  return makeWords(parseInt(num)).trim() + " only";
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [staff, setStaff] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser({ 
          email: currentUser.email, 
          name: currentUser.email.split('@')[0], 
          role: "Owner"
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const unsubOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubStaff = onSnapshot(collection(db, "staff"), (snapshot) => {
      const liveStaff = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaff(liveStaff);

      const profileLookup = liveStaff.find(s => s.email.toLowerCase() === user.email.toLowerCase());
      if (profileLookup) {
        if (profileLookup.status === "Blocked") {
          alert("❌ Access Denied: Your staff profile has been blocked by administration.");
          signOut(auth);
        } else {
          setUser(prev => ({ ...prev, role: profileLookup.role || "Staff", name: profileLookup.name }));
        }
      }
    });

    const unsubLogs = onSnapshot(collection(db, "call_logs"), (snapshot) => {
      setCallLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubOrders();
      unsubStaff();
      unsubLogs();
    };
  }, [user?.email]);

  if (loading) {
    return (
      <div className="login-overlay">
        <div className="login-card">
          <p className="loading-grid-text">
            CONNECTING TO ATWOK CLOUD COMPUTE GRID...
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, setUser, orders, staff, callLogs, activeTab, setActiveTab }}>
      {children}
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainLayoutRouter />
    </AppProvider>
  );
}

function MainLayoutRouter() {
  const { user, activeTab, setActiveTab, orders } = useContext(AppContext);
  const [syncing, setSyncing] = useState(false);

  if (!user) return <LoginView />;

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('https://shopifycaller.onrender.com/api/sync-last-order');
      const data = await res.json();
      if (data.success) {
        alert("⚡ Backend Awoken & Active! Incoming webhooks are synced.");
      }
    } catch (err) {
      alert("⏳ Server waking up from free-tier sleep... click once more in 10 seconds!");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="app-viewport">
      <aside className="sidebar-container no-print">
        <div className="brand-header">
          <div className="brand-icon"><span>Ω</span></div>
          <div className="brand-text">
            <span className="brand-name">ATWOK</span>
            <span className="brand-tag">AUTOMATED LIVE STREAM</span>
          </div>
        </div>

        <nav className="nav-menu">
          <button className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            <span className="nav-icon">⚡</span> Call Terminal
          </button>
          {user.role === "Owner" && (
            <>
              <button className={`nav-item ${activeTab === "staff" ? "active" : ""}`} onClick={() => setActiveTab("staff")}>
                <span className="nav-icon">🛡️</span> Staff Security
              </button>
              <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                <span className="nav-icon">⚙️</span> Engine Config
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile-badge">
            <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <span className="user-name">{user.name}</span>
              <span className="user-role">{user.role}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header no-print">
          <div className="header-title">
            <h2>
              {activeTab === "dashboard" && "Call Center Dispatch Control"}
              {activeTab === "staff" && "Identity & Access Control"}
              {activeTab === "settings" && "System Configuration"}
            </h2>
          </div>
          <div className="header-status">
            <button className="primary-btn sm sync-engine-btn" onClick={handleManualSync} disabled={syncing}>
              {syncing ? "⏳ Syncing..." : "📥 Fetch Engine"}
            </button>
            <span className="live-dot"></span>
            <span className="status-text">Stream: {orders.length} Logged</span>
          </div>
        </header>

        <div className="content-container">
          {activeTab === "dashboard" && <DashboardView />}
          {activeTab === "staff" && <StaffView />}
          {activeTab === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}

function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError("Invalid workspace credential combination.");
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-box-glow">
        <div className="login-card">
          <div className="login-brand">
            <div className="brand-icon lg">Ω</div>
            <h2>Atwok Gateway</h2>
            <p>Enter node parameters to access pipeline</p>
          </div>
          {error && <div className="login-error-msg">{error}</div>}
          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <label>Work Email</label>
              <input type="email" placeholder="owner@atwok.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="input-group">
              <label>Security Key</label>
              <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="primary-btn">Initialize Session</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DashboardView() {
  const { orders, user, callLogs } = useContext(AppContext);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [printOrdersList, setPrintOrdersList] = useState([]);

  const updateStatusInFirestore = async (id, newStatus) => {
    if (!id) return;
    const orderRef = doc(db, "orders", id);
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
  };

  const handleDeleteOrderClick = async (orderId, shopifyId) => {
    const confirmation = window.confirm(`⚠️ Action Irreversible!\nAre you sure you want to permanently delete order ${shopifyId || 'this order'} from the records?`);
    if (confirmation) {
      try {
        await deleteDoc(doc(db, "orders", orderId));
        alert(`🗑️ Order ${shopifyId} deleted successfully.`);
      } catch (err) {
        console.error("❌ Error deleting document: ", err);
        alert("Failed to delete the order. Please check permissions.");
      }
    }
  };

  const getRawOrderDate = (order) => {
    if (order && order.createdAt) {
      if (typeof order.createdAt === 'string') {
        const parsed = new Date(order.createdAt);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      if (order.createdAt.seconds) {
        return new Date(order.createdAt.seconds * 1000);
      }
      if (order.createdAt instanceof Date) {
        return order.createdAt;
      }
    }
    return new Date();
  };

  const getOrderDateKeyStr = (order) => {
    const dateObj = getRawOrderDate(order);
    return dateObj.toLocaleDateString('en-GB');
  };

  const getOrderTimeStr = (order) => {
    const dateObj = getRawOrderDate(order);
    return dateObj.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getOrderNumber = (order) => {
    if (!order || !order.shopifyOrderId) return 0;
    const num = String(order.shopifyOrderId).replace(/[^0-9]/g, '');
    return parseInt(num, 10) || 0;
  };

  const trackCallInitiation = async (order) => {
    try {
      await addDoc(collection(db, "call_logs"), {
        operatorEmail: user.email,
        operatorName: user.name,
        shopifyOrderId: order.shopifyOrderId || "Unknown",
        customerPhone: order.phone || "Unknown",
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("❌ Telephony log error: ", err);
    }
  };

  const filteredOrders = orders.filter(o => {
    const databaseStatus = (o.status || "Pending").toLowerCase();
    
    const matchesSearch = (o.customerName || "").toLowerCase().includes(search.toLowerCase()) || 
                          (o.phone || "").includes(search) || 
                          (o.shopifyOrderId || "").toLowerCase().includes(search.toLowerCase()) ||
                          (o.product || "").toLowerCase().includes(search.toLowerCase());
                          
    let matchesStatus = statusFilter === "All" || databaseStatus === statusFilter.toLowerCase();
    if (statusFilter === "Pending" && (databaseStatus === "pending" || databaseStatus === "pending call")) {
      matchesStatus = true;
    }
    
    return matchesSearch && matchesStatus;
  });

  const uniqueOrdersMap = new Map();
  filteredOrders.forEach(order => {
    const orderKey = order.shopifyOrderId || order.id;
    if (!uniqueOrdersMap.has(orderKey)) {
      uniqueOrdersMap.set(orderKey, order);
    } else {
      const existing = uniqueOrdersMap.get(orderKey);
      if (existing.product === "Shopify Product" && order.product !== "Shopify Product") {
        uniqueOrdersMap.set(orderKey, order);
      }
    }
  });

  const uniqueOrdersList = Array.from(uniqueOrdersMap.values());

  const ordersByDateGroups = {};
  uniqueOrdersList.forEach(order => {
    const dateKey = getOrderDateKeyStr(order);
    if (!ordersByDateGroups[dateKey]) {
      ordersByDateGroups[dateKey] = [];
    }
    ordersByDateGroups[dateKey].push(order);
  });

  const sortedDateKeys = Object.keys(ordersByDateGroups).sort((a, b) => {
    const partsA = a.split('/');
    const partsB = b.split('/');
    const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
    const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
    return dateB.getTime() - dateA.getTime();
  });

  const todayStrStr = new Date().toLocaleDateString('en-GB');
  const totalCallsToday = callLogs.filter(log => log.timestamp && new Date(log.timestamp).toLocaleDateString('en-GB') === todayStrStr).length;

  // 🖨️ RELIABLE BATCH PRINT TRIGGER (FIXED TYPO)
  const handlePrintBatch = (targetOrders) => {
    const confirmed = targetOrders.filter(o => (o.status || "").toLowerCase() === "confirmed");
    if (confirmed.length === 0) {
      alert("No confirmed orders found in this date section to print!");
      return;
    }
    setPrintOrdersList(confirmed);
  };

  // Trigger print dialog immediately after DOM re-renders with new thermal label items
  useEffect(() => {
    if (printOrdersList.length > 0) {
      const timer = setTimeout(() => {
        window.print();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [printOrdersList]);

  return (
    <div className="dashboard-space">
      <div className="glass-panel no-print filter-panel-wrapper">
        <div className="panel-toolbar">
          <div className="search-input-wrapper search-box-container">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="toolbar-actions actions-flex-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="select-pill">
              <option value="All">All Status Options</option>
              <option value="Pending">Pending Call</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Call Back Later">Call Back Later</option>
              <option value="Bad Address">Bad Address</option>
            </select>
            <div className="dials-counter-chip">
              📞 Dials Today: {totalCallsToday}
            </div>
          </div>
        </div>
      </div>

      {sortedDateKeys.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
          Waiting for live Shopify data to populate routing rows...
        </div>
      ) : (
        sortedDateKeys.map(dateKey => {
          const rawGroupOrders = ordersByDateGroups[dateKey];
          const sortedGroupOrders = [...rawGroupOrders].sort((a, b) => getOrderNumber(b) - getOrderNumber(a));

          const pCount = sortedGroupOrders.filter(o => {
            const st = (o.status || "Pending").toLowerCase();
            return st === "pending" || st === "pending call";
          }).length;
          const confCount = sortedGroupOrders.filter(o => (o.status || "").toLowerCase() === "confirmed").length;
          const cbCount = sortedGroupOrders.filter(o => (o.status || "").toLowerCase() === "call back later").length;
          const badCount = sortedGroupOrders.filter(o => (o.status || "").toLowerCase() === "bad address").length;
          const cancCount = sortedGroupOrders.filter(o => (o.status || "").toLowerCase() === "cancelled").length;

          return (
            <div key={dateKey} className="glass-panel card-group-block no-print day-order-card-wrapper">
              <div className="date-card-header header-flex-wrap">
                <div className="header-date-title-side">
                  <span className="date-pill-tag">
                    📅 {dateKey === todayStrStr ? `TODAY (${dateKey})` : dateKey}
                  </span>
                  <span className="total-orders-count-text">
                    ({sortedGroupOrders.length} Orders)
                  </span>
                </div>

                <div className="status-chips-container-row">
                  <span className="stat-pill-chip status-pending-pill">🟡 {pCount}</span>
                  <span className="stat-pill-chip status-confirmed-pill">🟢 {confCount}</span>
                  <span className="stat-pill-chip status-callback-pill">🔵 {cbCount}</span>
                  <span className="stat-pill-chip status-bad-pill">⚠️ {badCount}</span>
                  <span className="stat-pill-chip status-cancelled-pill">🔴 {cancCount}</span>
                  
                  <button className="primary-btn sm batch-print-btn" onClick={() => handlePrintBatch(sortedGroupOrders)}>
                    🖨️ Print ({confCount})
                  </button>
                </div>
              </div>

              <div className="table-container responsive-table-viewport">
                <table className="custom-table fully-responsive-datatable">
                  <thead>
                    <tr className="desktop-table-header-row">
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody className="responsive-table-body-container">
                    {sortedGroupOrders.map(order => {
                      const callCountForThisOrder = callLogs.filter(log => log.shopifyOrderId === order.shopifyOrderId).length;
                      const paymentDisplay = (order.paymentMode?.toLowerCase().includes('prepaid')) ? 'Prepaid' : 'COD';

                      return (
                        <tr key={order.id} className="table-row-item-node" style={{ opacity: (order.status || "").toLowerCase() === 'bad address' ? 0.5 : 1 }}>
                          
                          <td className="font-mono text-highlight cell-padding-optimized target-order-id-block">
                            <div>{order.shopifyOrderId || "#"}</div>
                            <div className="time-stamp-subtext desktop-only-element">
                              🕒 {getOrderTimeStr(order)}
                            </div>
                          </td>

                          <td className="cell-padding-optimized target-customer-block">
                            <div className="customer-cell">
                              <span className="customer-display-title">{order.customerName || "Guest Customer"}</span>
                              <span className="phone-text sub-phone-gray">{order.phone || "No Phone"}</span>
                            </div>
                          </td>

                          <td className="product-cell cell-padding-optimized text-size-11 target-product-title-block" title={order.product}>
                            {getShortProductTitle(order.product)}
                          </td>

                          <td className="font-mono font-bold cell-padding-optimized text-size-12 target-amount-block">
                            <span className="mobile-price-num">₹{Number(order.amount || 0).toLocaleString('en-IN')}</span>
                            <span className={`payment-mode-label ${paymentDisplay === 'Prepaid' ? 'mode-prepaid' : 'mode-cod'}`}>
                              {paymentDisplay}
                            </span>
                          </td>

                          <td className="cell-padding-optimized target-status-selection-block">
                            <select value={order.status || "Pending"} onChange={e => updateStatusInFirestore(order.id, e.target.value)} className={`status-select ${(order.status || "Pending").toLowerCase().replace(/\s+/g, '-')}`}>
                              <option value="Pending">🟡 Pending</option>
                              <option value="Confirmed">🟢 Confirmed</option>
                              <option value="Cancelled">🔴 Cancelled</option>
                              <option value="Call Back Later">🔵 Call Back</option>
                              <option value="Bad Address">⚠️ Bad Addr</option>
                            </select>
                          </td>

                          <td className="cell-padding-optimized target-actions-control-block">
                            <div className="table-actions-container-row">
                              <a href={`tel:${order.phone}`} className="action-dialer-btn" onClick={() => trackCallInitiation(order)}>
                                📞
                                {callCountForThisOrder > 0 && <span className="dial-badge-counter">{callCountForThisOrder}</span>}
                              </a>
                              <button className="ghost-btn inspect-btn-padding" onClick={() => setSelectedOrder(order)}>Inspect</button>
                              <button className="danger-btn-trash-icon desktop-only-element" title="Delete Order Permanently" onClick={() => handleDeleteOrderClick(order.id, order.shopifyOrderId)}>🗑️</button>
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      {selectedOrder && <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}

      {/* THERMAL PRINT RENDER CONTAINER */}
      <div className="print-label-area">
        {printOrdersList.map((order, idx) => (
          <ThermalShippingLabel key={order.id || idx} order={order} />
        ))}
      </div>
    </div>
  );
}

function ThermalShippingLabel({ order }) {
  let displayDate = new Date().toLocaleDateString('en-GB');
  if (order.createdAt) {
    const parsedDate = new Date(order.createdAt);
    if (!isNaN(parsedDate.getTime())) displayDate = parsedDate.toLocaleDateString('en-GB');
  }

  const formatAddress = (text) => {
    if (!text) return [];
    return text.split(",").map(line => line.trim()).filter(line => line !== "" && line.toLowerCase() !== "india");
  };

  const addressLines = formatAddress(order.address || "");
  const paymentType = (order.paymentMode?.toLowerCase().includes('prepaid')) ? 'Prepaid' : 'COD';

  return (
    <div className="thermal-label-page">
      <div className="label-sheet">
        <div className="label-header">
          <div className="ids-column">
            <div className="id-text-large">CUST ID: 1570518663</div>
            <div className="id-text-large">CONT ID: 41445021</div>
          </div>
          <div className="date-display-large">{displayDate}</div>
        </div>
        <div className="label-divider-thin"></div>
        <div className="to-header">TO</div>
        <div className="address-section">
          <div className="customer-name-premium">{order.customerName || "GUEST CUSTOMER"}</div>
          {addressLines.map((line, i) => <div key={i} className="address-line-premium">{line}</div>)}
          {order.phone && <div className="address-line-premium" style={{ marginTop: '6px', fontSize: '14px', fontWeight: '900' }}>📞 {order.phone}</div>}
        </div>
        <div className="thick-divider"></div>
        <div className="footer-details">
          <div className="from-side">
            <span className="mini-label">FROM:</span>
            <div className="from-text"><strong>ATWOK</strong><br />GH Bazaar, Kozhikode<br />Kerala - 673001<br /><strong>PH: 9539552863</strong></div>
          </div>
          <div className="item-side">
            <span className="mini-label">PRODUCT:</span>
            <div className="product-display-name">{getLabelProductTitle(order.product)}</div>
          </div>
        </div>
        {paymentType === "COD" ? (
          <div className="payment-banner-box">
            <div className="cod-compact">
              <div className="cod-text-wrap">COD AMT: ₹{Number(order.amount || 0)}/-</div>
              <div className="amt-words-bold">({numberToWords(order.amount)})</div>
            </div>
          </div>
        ) : (
          <div className="payment-banner-box center-align"><div className="banner-type">PREPAID</div></div>
        )}
        <div className="thanks-footer">THANKS FOR SHOPPING WITH ATWOK</div>
      </div>
    </div>
  );
}

function OrderDetailsModal({ order, onClose }) {
  const { callLogs } = useContext(AppContext);
  const [customerName, setCustomerName] = useState(order.customerName || "");
  const [phone, setPhone] = useState(order.phone || "");
  const [address, setAddress] = useState(order.address || "");
  const [product, setProduct] = useState(order.product || "");
  const [amount, setAmount] = useState(order.amount || "");
  const [paymentMode, setPaymentMode] = useState(order.paymentMode || "COD");
  const [status, setStatus] = useState(order.status || "Pending");
  const [remarks, setRemarks] = useState(order.remarks || "");
  const [saving, setSaving] = useState(false);

  const itemCallHistory = callLogs
    .filter(log => log.shopifyOrderId === order.shopifyOrderId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const handleSaveOrder = async () => {
    if (!order.id) return;
    setSaving(true);
    try {
      const orderRef = doc(db, "orders", order.id);
      await updateDoc(orderRef, {
        customerName, phone, address, product, amount: String(amount), paymentMode, status, remarks, updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("❌ Failed saving order details: ", err);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop no-print modal-padding-wrapper">
      <div className="modal-glow-wrap structural-modal-width">
        <div className="modal-card inspect-modal-spacing">
          <div className="modal-header header-modal-layout">
            <div>
              <h3>Inspect & Edit Client Details</h3>
              <span className="modal-subtitle modal-subtitle-blue">{order.shopifyOrderId}</span>
            </div>
            <button className="close-btn close-x-btn-layout" onClick={onClose}>&times;</button>
          </div>

          <div className="telephony-trace-log-box">
            <span className="telephony-trace-title">📞 TELEPHONY HISTORY</span>
            {itemCallHistory.length === 0 ? (
              <p className="no-logs-captured-text">No outbound logs captured on this database index record yet.</p>
            ) : (
              <div className="telephony-trace-scroll-view">
                {itemCallHistory.map((log, idx) => (
                  <div key={idx} className="telephony-log-line-item">
                    🔹 Call {idx + 1}: Dialed by <strong>{log.operatorName}</strong> at {new Date(log.timestamp).toLocaleString('en-IN')}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-form-grid structural-form-grid">
            <div className="input-group"><label>Customer Name</label><input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} /></div>
            <div className="input-group"><label>Phone Number</label><input type="text" value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div className="input-group full-width-grid-column"><label>Delivery Address String</label><textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
            <div className="input-group"><label>Product Heading</label><input type="text" value={product} onChange={e => setProduct(e.target.value)} /></div>
            <div className="input-group"><label>Gross Value (₹)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="input-group">
              <label>Payment Mode</label>
              <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                <option value="COD">COD</option>
                <option value="Prepaid">Prepaid</option>
              </select>
            </div>
            <div className="input-group">
              <label>Status Resolution</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="Pending">Pending Call</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Call Back Later">Call Back Later</option>
                <option value="Bad Address">Bad Address</option>
              </select>
            </div>
            <div className="input-group full-width-grid-column"><label>Operator Remarks</label><textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} /></div>
          </div>

          <div className="modal-footer save-actions-footer-row">
            <button className="secondary-btn btn-padding-sm" onClick={onClose}>Cancel</button>
            <button className="primary-btn btn-padding-sm" onClick={handleSaveOrder} disabled={saving}>{saving ? "Saving..." : "Save Details"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffView() {
  const { staff } = useContext(AppContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const addStaffMember = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "staff"), { name, email, role: "Staff", status: "Active", createdAt: serverTimestamp() });
    setName(""); setEmail("");
  };

  const toggleStaffStatus = async (id, currentStatus) => {
    const nextStatus = currentStatus === "Blocked" ? "Active" : "Blocked";
    await updateDoc(doc(db, "staff", id), { status: nextStatus });
  };

  return (
    <div className="split-grid staff-grid-responsive-layout">
      <div className="glass-panel p-6">
        <h3>Provision Operator Account</h3>
        <form onSubmit={addStaffMember} className="stack-form">
          <div className="input-group"><label>Employee Name</label><input type="text" placeholder="Rahul" value={name} onChange={e => setName(e.target.value)} required /></div>
          <div className="input-group"><label>Work Email</label><input type="email" placeholder="rahul@atwok.com" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <button type="submit" className="primary-btn">Save Staff Member</button>
        </form>
      </div>

      <div className="glass-panel p-6">
        <h3>Active Workspace Identity Management</h3>
        <div className="staff-list identity-list-spacing">
          {staff.map(s => (
            <div key={s.id} className="staff-row single-staff-card-row" style={{ opacity: s.status === 'Blocked' ? 0.4 : 1 }}>
              <div className="staff-info">
                <span className="staff-name bold-font-display">{s.name}</span>
                <span className="staff-email gray-email-text">{s.email}</span>
              </div>
              <div className="staff-action-badge-row">
                <span className={`role-tag status-${(s.status || "Active").toLowerCase()} status-badge-layout`}>{s.status || "Active"}</span>
                <button onClick={() => toggleStaffStatus(s.id, s.status)} className="primary-btn sm interactive-cursor-pointer toggle-status-btn-color">
                  {s.status === 'Blocked' ? "🔓 Activate" : "🚫 Block"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="glass-panel p-6 max-w-lg no-print">
      <h3>System Operations Parameters</h3>
      <p className="settings-telemetry-text">Automated data telemetry paired successfully over shopifycaller endpoint vectors.</p>
    </div>
  );
}