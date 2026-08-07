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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Auth State Observer
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

  // Firestore Realtime Collections Sync
  useEffect(() => {
    if (!user) return;
    
    const unsubOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
      const liveOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOrders(liveOrders);
    });

    const unsubStaff = onSnapshot(collection(db, "staff"), (snapshot) => {
      const liveStaff = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaff(liveStaff);
    });

    return () => {
      unsubOrders();
      unsubStaff();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="login-overlay">
        <div className="login-card">
          <p style={{ letterSpacing: '0.06em', fontSize: '11px', color: 'var(--primary-accent)', fontWeight: '700' }}>
            CONNECTING TO ATWOK CLOUD COMPUTE GRID...
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, setUser, orders, staff, activeTab, setActiveTab }}>
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

  if (!user) return <LoginView />;

  return (
    <div className="app-viewport">
      
      {/* SIDEBAR NAVIGATION */}
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
          <button className={`nav-item ${activeTab === "staff" ? "active" : ""}`} onClick={() => setActiveTab("staff")}>
            <span className="nav-icon">🛡️</span> Staff Security
          </button>
          <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
            <span className="nav-icon">⚙️</span> Engine Config
          </button>
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

      {/* MAIN CONTENT AREA */}
      <main className="main-content flex-1">
        <header className="top-header no-print">
          <div className="header-title">
            <h2>
              {activeTab === "dashboard" && "Call Center Dispatch Control"}
              {activeTab === "staff" && "Identity & Access Control"}
              {activeTab === "settings" && "System Configuration"}
            </h2>
          </div>
          <div className="header-status">
            <span className="live-dot"></span>
            <span className="status-text">Cloud Stream Active: {orders.length} Logged</span>
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

// ============================================================================
// LOGIN GATEWAY MODULE
// ============================================================================
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
          {error && <div style={{ color: '#f87171', fontSize: '11px', marginBottom: '14px', fontWeight: '600' }}>{error}</div>}
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

// ============================================================================
// CALL TERMINAL DISPATCH TERMINAL
// ============================================================================
function DashboardView() {
  const { orders } = useContext(AppContext);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [printOrdersList, setPrintOrdersList] = useState([]);

  const updateStatusInFirestore = async (id, newStatus) => {
    const orderRef = doc(db, "orders", id);
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
  };

  // Convert raw text strings or dates safely for strict time & date processing
  const getRawOrderDate = (order) => {
    if (order.createdAt) {
      if (typeof order.createdAt === 'string') {
        const parsed = new Date(order.createdAt);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      if (order.createdAt.seconds) {
        return new Date(order.createdAt.seconds * 1000);
      }
    }
    return new Date();
  };

  // Extract clean localized time string (e.g., "05:07 PM")
  const getOrderTimeStr = (order) => {
    const dateObj = getRawOrderDate(order);
    return dateObj.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  // Safe numerical parser for sequence fallback (#AS-2200 -> 2200)
  const getOrderNumber = (order) => {
    if (!order.shopifyOrderId) return 0;
    const num = order.shopifyOrderId.replace(/[^0-9]/g, '');
    return parseInt(num, 10) || 0;
  };

  // Group text layouts by day tags
  const getOrderDateKey = (order) => {
    const dateObj = getRawOrderDate(order);
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Search filter matching
  const filteredOrders = orders.filter(o => {
    const matchesSearch = (o.customerName || "").toLowerCase().includes(search.toLowerCase()) || 
                          (o.phone || "").includes(search) || 
                          (o.shopifyOrderId || "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Group entries under separate date objects
  const groupedOrders = filteredOrders.reduce((groups, order) => {
    const dateKey = getOrderDateKey(order);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(order);
    return groups;
  }, {});

  // Sort dates so newest cards stay on top
  const sortedDateKeys = Object.keys(groupedOrders).sort((a, b) => {
    const [dayA, monthA, yearA] = a.split('/');
    const [dayB, monthB, yearB] = b.split('/');
    return new Date(`${yearB}-${monthB}-${dayB}`).getTime() - new Date(`${yearA}-${monthA}-${dayA}`).getTime();
  });

  const pendingCount = orders.filter(o => o.status === "Pending").length;
  const confirmedOrders = orders.filter(o => o.status === "Confirmed");
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.amount || 0), 0);

  const handlePrintBatch = (targetOrders) => {
    const confirmed = targetOrders.filter(o => o.status === "Confirmed");
    if (confirmed.length === 0) {
      alert("No confirmed orders found inside this card cluster to print!");
      return;
    }
    setPrintOrdersList(confirmed);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <div className="dashboard-space">
      
      {/* NAVIGATION STATS DISPLAY PANEL */}
      <div className="stats-grid no-print">
        <div className="stat-card">
          <span className="stat-label">Pending Confirmation</span>
          <div className="stat-value-row">
            <span className="stat-number">{pendingCount}</span>
            <span className="stat-pill yellow">Action Required</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Confirmed Value</span>
          <div className="stat-value-row">
            <span className="stat-number">₹{totalRevenue.toLocaleString('en-IN')}</span>
            <span className="stat-pill green">Pipeline Gross</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Cloud Synced</span>
          <div className="stat-value-row">
            <span className="stat-number">{orders.length}</span>
            <span className="stat-pill blue">Live Feed</span>
          </div>
        </div>
      </div>

      <div className="glass-panel no-print">
        <div className="panel-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              placeholder="Search customer, phone, shopify order ID..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          <div className="toolbar-actions">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="select-pill">
              <option value="All">All Status Options</option>
              <option value="Pending">Pending Call</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Call Back Later">Call Back Later</option>
              <option value="Bad Address">Bad Address</option>
            </select>
            <button className="primary-btn sm" onClick={() => handlePrintBatch(confirmedOrders)}>
              🖨️ Print All Confirmed ({confirmedOrders.length})
            </button>
          </div>
        </div>

        {/* CLUSTER HEADER ARRANGEMENT RENDERING SECTION */}
        <div className="date-groups-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
          {sortedDateKeys.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              Waiting for automated Make.com engine streams or filter matches...
            </div>
          ) : (
            sortedDateKeys.map(dateKey => {
              // STRICT TIMESTAMP & TIME SORTING: Newest time of the day stays on top
              const dateOrders = groupedOrders[dateKey].sort((a, b) => {
                const timeDiff = getRawOrderDate(b) - getRawOrderDate(a);
                if (timeDiff !== 0) return timeDiff;
                return getOrderNumber(b) - getOrderNumber(a);
              });
              const dateConfirmed = dateOrders.filter(o => o.status === "Confirmed");

              return (
                <div key={dateKey} className="date-card-wrapper" style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
                }}>
                  <div className="date-card-header" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '14px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    paddingBottom: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: '#6366f1' }}>📅 {dateKey}</span>
                      <span style={{ fontSize: '11px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                        {dateOrders.length} Orders
                      </span>
                    </div>
                    <button 
                      className="primary-btn sm" 
                      style={{ background: '#10b981', borderColor: '#059669' }}
                      onClick={() => handlePrintBatch(dateOrders)}
                    >
                      🖨️ Bulk Print {dateKey} Labels ({dateConfirmed.length} Confirmed)
                    </button>
                  </div>

                  <div className="table-container">
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Customer Name</th>
                          <th>Product Specs</th>
                          <th>Amount</th>
                          <th>Status Decision</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateOrders.map(order => (
                          <tr key={order.id} style={{ opacity: order.status === 'Bad Address' ? 0.5 : 1 }}>
                            <td className="font-mono text-highlight">
                              <div>{order.shopifyOrderId || "#"}</div>
                              <div style={{ fontSize: '10px', color: '#818cf8', marginTop: '2px', fontWeight: '600' }}>
                                🕒 {getOrderTimeStr(order)}
                              </div>
                            </td>
                            <td>
                              <div className="customer-cell">
                                <span className="customer-name">{order.customerName || "Guest Customer"}</span>
                                <span className="phone-text" style={{ fontSize: '11px', color: '#94a3b8' }}>
                                  {order.phone || "No Phone"}
                                </span>
                              </div>
                            </td>
                            <td className="product-cell">{order.product || "Shopify Item"}</td>
                            <td className="font-mono font-bold">
                              ₹{Number(order.amount || 0).toLocaleString('en-IN')}
                              <span style={{ 
                                display: 'block', 
                                fontSize: '10px', 
                                marginTop: '2px',
                                fontWeight: '700',
                                color: (order.paymentMode && order.paymentMode.toLowerCase().includes('prepaid')) ? '#34d399' : '#f59e0b' 
                              }}>
                                {(order.paymentMode && order.paymentMode.toLowerCase().includes('prepaid')) ? 'Prepaid' : 'COD'}
                              </span>
                            </td>
                            <td>
                              <select 
                                value={order.status || "Pending"} 
                                onChange={e => updateStatusInFirestore(order.id, e.target.value)}
                                className={`status-select ${(order.status || "Pending").toLowerCase().replace(/\s+/g, '-')}`}
                              >
                                <option value="Pending">🟡 Pending Call</option>
                                <option value="Confirmed">🟢 Confirmed</option>
                                <option value="Cancelled">🔴 Cancelled</option>
                                <option value="Call Back Later">🔵 Call Back Later</option>
                                <option value="Bad Address">⚠️ Bad Address</option>
                              </select>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <a 
                                  href={`tel:${order.phone}`} 
                                  className="action-dialer-btn"
                                  title="Open Dialer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: 'rgba(16, 185, 129, 0.2)',
                                    border: '1px solid rgba(16, 185, 129, 0.4)',
                                    color: '#34d399',
                                    textDecoration: 'none',
                                    fontSize: '14px'
                                  }}
                                >
                                  📞
                                </a>
                                <button className="ghost-btn" onClick={() => setSelectedOrder(order)}>Inspect</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedOrder && (
        <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      {/* HIDDEN PRINT MATRIX DISPATCH RENDERING INTERFACE */}
      <div className="print-label-area">
        {printOrdersList.map((order, idx) => (
          <ThermalShippingLabel key={order.id || idx} order={order} />
        ))}
      </div>

    </div>
  );
}

// ============================================================================
// COMPACT 100x150 MM THERMAL SHIPPING LABEL COMPONENT (NO EMPTY SPACES)
// ============================================================================
function ThermalShippingLabel({ order }) {
  let displayDate = new Date().toLocaleDateString('en-GB');
  if (order.createdAt) {
    const parsedDate = new Date(order.createdAt);
    if (!isNaN(parsedDate.getTime())) {
      displayDate = parsedDate.toLocaleDateString('en-GB');
    }
  }

  const formatAddress = (text) => {
    if (!text) return [];
    return text.split(",").map(line => line.trim()).filter(line => line !== "" && line.toLowerCase() !== "india");
  };

  const addressLines = formatAddress(order.address || "");
  const paymentType = (order.paymentMode && order.paymentMode.toLowerCase().includes('prepaid')) ? 'Prepaid' : 'COD';

  return (
    <div className="thermal-label-page">
      <div className="label-sheet">
        
        {/* HEADER META ROW */}
        <div className="label-header">
          <div className="ids-column">
            <div className="id-text-large">CUST ID: 1570518663</div>
            <div className="id-text-large">CONT ID: 41445021</div>
          </div>
          <div className="date-display-large">{displayDate}</div>
        </div>

        <div className="label-divider-thin"></div>

        {/* CUSTOMER DESTINATION SPECIFICATIONS BOX */}
        <div className="to-header">TO</div>
        <div className="address-section">
          <div className="customer-name-premium">{order.customerName || "GUEST CUSTOMER"}</div>
          {addressLines.map((line, i) => (
            <div key={i} className="address-line-premium">{line}</div>
          ))}
          {order.phone && (
            <div className="address-line-premium" style={{ marginTop: '6px', fontSize: '14px', fontWeight: '900' }}>
              📞 {order.phone}
            </div>
          )}
        </div>

        <div className="thick-divider"></div>

        {/* METRIC ROW DISPLAY FOOTER */}
        <div className="footer-details">
          <div className="from-side">
            <span className="mini-label">FROM:</span>
            <div className="from-text">
              <strong style={{ fontSize: '11px', fontWeight: '900' }}>ATWOK</strong><br />
              GH Bazaar, Kozhikode<br />
              Kerala - 673001<br />
              <strong>PH: 9539552863</strong>
            </div>
          </div>
          <div className="item-side">
            <span className="mini-label">PRODUCT:</span>
            <div className="product-display-name">{order.product || ""}</div>
          </div>
        </div>

        {/* PAYMENT TRACKING BOX SWITCHES */}
        {paymentType === "COD" ? (
          <div className="payment-banner-box">
            <div className="cod-compact">
              <div className="cod-text-wrap">
                COD AMT: ₹{Number(order.amount || 0)}/-
              </div>
              <div className="amt-words-bold">
                ({numberToWords(order.amount)})
              </div>
            </div>
          </div>
        ) : (
          <div className="payment-banner-box center-align">
            <div className="banner-type">PREPAID</div>
          </div>
        )}

        <div className="thanks-footer">THANKS FOR SHOPPING WITH ATWOK</div>
      </div>
    </div>
  );
}

// ============================================================================
// INSPECTION AND REAL-TIME ADDRESS EDITOR MODAL
// ============================================================================
function OrderDetailsModal({ order, onClose }) {
  const [customerName, setCustomerName] = useState(order.customerName || "");
  const [phone, setPhone] = useState(order.phone || "");
  const [address, setAddress] = useState(order.address || "");
  const [product, setProduct] = useState(order.product || "");
  const [amount, setAmount] = useState(order.amount || "");
  const [paymentMode, setPaymentMode] = useState(order.paymentMode || "COD");
  const [status, setStatus] = useState(order.status || "Pending");
  const [remarks, setRemarks] = useState(order.remarks || "");
  const [saving, setSaving] = useState(false);

  const handleSaveOrder = async () => {
    setSaving(true);
    const orderRef = doc(db, "orders", order.id);
    await updateDoc(orderRef, {
      customerName,
      phone,
      address,
      product,
      amount,
      paymentMode,
      status,
      remarks,
      updatedAt: serverTimestamp()
    });
    setSaving(false);
    onClose();
  };

  const markBadAddress = async () => {
    setStatus("Bad Address");
    const orderRef = doc(db, "orders", order.id);
    await updateDoc(orderRef, {
      status: "Bad Address",
      remarks: remarks ? `${remarks} (Flagged as Bad Address)` : "Flagged as Bad Address",
      updatedAt: serverTimestamp()
    });
    onClose();
  };

  return (
    <div className="modal-backdrop no-print">
      <div className="modal-glow-wrap">
        <div className="modal-card">
          <div className="modal-header">
            <div>
              <h3>Inspect & Edit Client Details</h3>
              <span className="modal-subtitle">{order.shopifyOrderId}</span>
            </div>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>

          <div className="modal-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
            <div className="input-group">
              <label>Customer Name</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>

            <div className="input-group">
              <label>Phone Number</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div className="input-group" style={{ gridColumn: 'span 2' }}>
              <label>Delivery Address String (Comma Separated)</label>
              <textarea 
                value={address} 
                onChange={e => setAddress(e.target.value)} 
                rows={3}
                placeholder="House name, Street name, PO City, State, Pincode" 
              />
            </div>

            <div className="input-group">
              <label>Product SKU Code</label>
              <input type="text" value={product} onChange={e => setProduct(e.target.value)} />
            </div>

            <div className="input-group">
              <label>Order Gross Value (₹)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>

            <div className="input-group">
              <label>Payment Class Method</label>
              <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                <option value="COD">COD</option>
                <option value="Prepaid">Prepaid</option>
              </select>
            </div>

            <div className="input-group">
              <label>Resolution Engine Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="Pending">Pending Call</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Call Back Later">Call Back Later</option>
                <option value="Bad Address">Bad Address</option>
              </select>
            </div>

            <div className="input-group" style={{ gridColumn: 'span 2' }}>
              <label>Operator Node Remarks</label>
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
            </div>
          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
            <button className="secondary-btn" style={{ background: '#7f1d1d', color: '#f87171', borderColor: '#991b1b' }} onClick={markBadAddress}>
              ⚠️ Flag as Bad Address
            </button>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="secondary-btn" onClick={onClose}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveOrder} disabled={saving}>
                {saving ? "Saving Changes..." : "Save Updated Details"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STAFF MANAGEMENT ACCESS MODULE
// ============================================================================
function StaffView() {
  const { staff } = useContext(AppContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const addStaffMember = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "staff"), {
      name,
      email,
      role: "Staff",
      createdAt: serverTimestamp()
    });
    setName("");
    setEmail("");
  };

  return (
    <div className="split-grid no-print">
      <div className="glass-panel p-6">
        <h3>Provision Operator Account</h3>
        <form onSubmit={addStaffMember} className="stack-form">
          <div className="input-group">
            <label>Employee Name</label>
            <input type="text" placeholder="John Doe" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Work Email</label>
            <input type="email" placeholder="john@atwok.com" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <button type="submit" className="primary-btn">Save Staff Member</button>
        </form>
      </div>

      <div className="glass-panel p-6">
        <h3>Active System Identity Registry</h3>
        <div className="staff-list">
          {staff.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No crew records initialized inside data collection nodes.</p>
          ) : (
            staff.map(s => (
              <div key={s.id} className="staff-row">
                <div className="staff-info">
                  <span className="staff-name">{s.name}</span>
                  <span className="staff-email">{s.email}</span>
                </div>
                <span className="role-tag">{s.role || "Staff"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ENGINE SYSTEM MANAGEMENT INFRASTRUCTURE VIEW
// ============================================================================
function SettingsView() {
  return (
    <div className="glass-panel p-6 max-w-lg no-print">
      <h3>System Operations Parameters</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
        Cloud Node Monolith Engine dynamically paired with atwokcaller collection endpoints via Make.com Ingestion Scripts.
      </p>
    </div>
  );
}