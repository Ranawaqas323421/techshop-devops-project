const API = "http://localhost:5000/api";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let products = [], cart = JSON.parse(localStorage.getItem("techshop-cart") || "[]");
let user = null, authMode = "login", activeCategory = "All", toastTimer;

const money = n => "$" + Number(n).toLocaleString("en-US", {maximumFractionDigits: 2});
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(path, options = {}) {
  const response = await fetch(API + path, {
    credentials: "include",
    headers: {"Content-Type": "application/json", ...(options.headers || {})},
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function productCard(p) {
  return `<article class="product-card">
    <div class="product-visual ${p.color}"><span class="product-badge">${p.category}</span><span class="product-emoji">${p.icon}</span><button class="quick-add" data-add="${p.id}" aria-label="Add ${p.name} to cart">+</button></div>
    <div class="product-info"><div class="product-category">${p.category}</div><h3>${p.name}</h3><div class="product-meta"><span class="price">${money(p.price)}</span><span class="rating">★ ${p.rating}</span></div></div>
  </article>`;
}
async function loadProducts() {
  try {
    products = await api("/products");
    renderProducts();
  } catch (e) {
    $("#product-grid").innerHTML = `<div class="loading-card">Can't reach the API. Start the Flask backend on port 5000, then refresh.</div>`;
  }
}
function renderProducts() {
  const filtered = products.filter(p => activeCategory === "All" || p.category === activeCategory);
  $("#product-grid").innerHTML = filtered.slice(0, 4).map(productCard).join("");
  $("#all-product-grid").innerHTML = filtered.map(productCard).join("");
  if (!filtered.length) $("#all-product-grid").innerHTML = `<div class="loading-card">No products found. Try another search.</div>`;
}
function setPage(page) {
  const isProducts = page === "products", isOrders = page === "orders";
  $("#hero").classList.toggle("hidden", isProducts || isOrders);
  $("#featured").classList.toggle("hidden", isProducts || isOrders);
  $("#why").classList.toggle("hidden", isProducts || isOrders);
  $("#all-products-section").classList.toggle("hidden", !isProducts);
  $("#orders-section").classList.toggle("hidden", !isOrders);
  $$(".nav-link").forEach(a => a.classList.toggle("active", a.dataset.page === page));
  if (isProducts) $("#all-products-section").scrollIntoView({behavior:"smooth",block:"start"});
  else if (isOrders) { $("#orders-section").scrollIntoView({behavior:"smooth",block:"start"}); loadOrders(); }
  else window.scrollTo({top:0,behavior:"smooth"});
}
function saveCart() { localStorage.setItem("techshop-cart", JSON.stringify(cart)); renderCart(); }
function addToCart(id) {
  const p = products.find(x => x.id === Number(id)); if (!p) return;
  const item = cart.find(x => x.id === p.id);
  if (item) item.quantity = Math.min(item.quantity + 1, 20);
  else cart.push({id:p.id, quantity:1});
  saveCart(); toast(`${p.name} added to your cart.`);
}
function cartDetails() {
  return cart.map(i => ({...products.find(p => p.id === i.id), quantity:i.quantity})).filter(i => i.id);
}
function renderCart() {
  const items = cartDetails(), count = items.reduce((n,i) => n+i.quantity,0);
  const subtotal = items.reduce((n,i) => n+i.price*i.quantity,0), shipping = subtotal === 0 || subtotal >= 100 ? 0 : 8;
  $("#cart-count").textContent = count; $("#drawer-count").textContent = `(${count})`;
  $("#cart-subtotal").textContent = money(subtotal); $("#shipping-cost").textContent = money(shipping); $("#cart-total").textContent = money(subtotal+shipping);
  $("#cart-items").innerHTML = items.length ? items.map(i => `<div class="cart-row"><div class="cart-thumb">${i.icon}</div><div><h4>${i.name}</h4><small>${money(i.price)} each</small><div class="qty-controls"><button data-qty="${i.id}" data-delta="-1">−</button><span>${i.quantity}</span><button data-qty="${i.id}" data-delta="1">+</button></div></div><button class="remove-btn" data-remove="${i.id}" aria-label="Remove ${i.name}">×</button></div>`).join("") : `<div class="cart-empty"><span>🛒</span><strong>Your cart is taking a little nap.</strong><p>Add something great to wake it up.</p></div>`;
  $("#checkout-btn").disabled = !items.length;
  $("#checkout-btn").style.opacity = items.length ? "1" : ".5";
}
function openAuth(mode = "login") {
  authMode = mode; const register = mode === "register";
  $("#auth-title").textContent = register ? "Create your account." : "Good to see you.";
  $("#auth-subtitle").textContent = register ? "A few details and you're in." : "Sign in to access your account and orders.";
  $("#name-wrap").classList.toggle("hidden", !register);
  $("#auth-submit").innerHTML = register ? "Create account <span>→</span>" : "Sign in securely <span>→</span>";
  $("#switch-auth").innerHTML = register ? 'Already a member? <button type="button">Sign in</button>' : 'New here? <button type="button">Create an account</button>';
  $("#auth-error").textContent = ""; $("#auth-form").reset(); $("#auth-modal").classList.remove("hidden");
}
function closeModal(id) { $("#"+id).classList.add("hidden"); }
function updateUser(next) {
  user = next; $("#account-label").textContent = user ? user.name.split(" ")[0] : "Sign in";
  $$(".auth-only").forEach(el => el.classList.toggle("hidden", !user));
  $("#account-btn").title = user ? `Signed in as ${user.email}` : "Sign in";
}
async function loadOrders() {
  if (!user) { openAuth("login"); toast("Sign in to view your orders."); return; }
  try {
    const rows = await api("/orders");
    $("#orders-list").innerHTML = rows.length ? rows.map(o => `<article class="order-card"><div><strong>Order #${o.id}</strong><p>${o.items.map(i=>`${i.name} × ${i.quantity}`).join(", ")}</p><small>${o.created_at}</small></div><strong>${money(o.total)}</strong></article>`).join("") : `<div class="loading-card">No orders yet. Your next favorite is waiting.</div>`;
  } catch(e) { toast(e.message); }
}
async function checkout() {
  if (!user) { closeCart(); openAuth("login"); toast("Sign in before placing your demo order."); return; }
  try {
    const result = await api("/orders", {method:"POST",body:JSON.stringify({items:cart})});
    cart = []; saveCart(); closeCart(); toast(`Order #${result.id} placed — demo checkout complete!`);
    setPage("orders");
  } catch(e) { toast(e.message); }
}
function closeCart() { $("#cart-drawer").classList.add("hidden"); }
function openCart() { renderCart(); $("#cart-drawer").classList.remove("hidden"); }

document.addEventListener("click", e => {
  const page = e.target.closest("[data-page]"); if (page) { e.preventDefault(); setPage(page.dataset.page); }
  const add = e.target.closest("[data-add]"); if (add) addToCart(add.dataset.add);
  const cat = e.target.closest("[data-category]");
  if (cat) { activeCategory = cat.dataset.category; $$(".category-chip").forEach(c=>c.classList.toggle("active",c===cat)); renderProducts(); }
  const qty = e.target.closest("[data-qty]");
  if (qty) { const item = cart.find(i=>i.id===Number(qty.dataset.qty)); if (item) { item.quantity += Number(qty.dataset.delta); if (item.quantity < 1) cart=cart.filter(i=>i.id!==item.id); if(item.quantity>20)item.quantity=20; saveCart(); } }
  const remove = e.target.closest("[data-remove]"); if(remove){cart=cart.filter(i=>i.id!==Number(remove.dataset.remove));saveCart();}
  const close = e.target.closest("[data-close]"); if(close) closeModal(close.dataset.close);
});
$("#cart-open").addEventListener("click", openCart);
$("#cart-close").addEventListener("click", closeCart);
$("#cart-drawer").addEventListener("click", e => { if(e.target === $("#cart-drawer")) closeCart(); });
$("#account-btn").addEventListener("click", () => user ? toast(`You're signed in as ${user.name}.`) : openAuth("login"));
$("#switch-auth").addEventListener("click", () => openAuth(authMode === "login" ? "register" : "login"));
$("#auth-modal").addEventListener("click", e => { if(e.target === $("#auth-modal")) closeModal("auth-modal"); });
$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault(); $("#auth-error").textContent = "";
  const form = new FormData(e.currentTarget), payload = Object.fromEntries(form.entries());
  try {
    const data = await api(authMode === "register" ? "/register" : "/login", {method:"POST",body:JSON.stringify(payload)});
    updateUser(data.user); closeModal("auth-modal"); toast(`Welcome${data.user.name ? ", "+data.user.name.split(" ")[0] : ""}!`);
  } catch(err) { $("#auth-error").textContent = err.message; }
});
$("#checkout-btn").addEventListener("click", checkout);
$("#learn-more").addEventListener("click", () => $("#why").scrollIntoView({behavior:"smooth"}));
$("#search-toggle").addEventListener("click", () => { setPage("products"); $("#search-input").focus(); });
$("#search-input").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  const filtered = products.filter(p => (activeCategory==="All" || p.category===activeCategory) && `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q));
  $("#all-product-grid").innerHTML = filtered.map(productCard).join("") || `<div class="loading-card">No matching products found.</div>`;
});
(async function init() {
  renderCart(); await loadProducts();
  try { const data = await api("/me"); updateUser(data.user); } catch { updateUser(null); }
})();
