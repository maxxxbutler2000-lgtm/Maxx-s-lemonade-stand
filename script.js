const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');
const checks = [...form.querySelectorAll('[name="items"]')];
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navigation');
menu.addEventListener('click', () => {const open=menu.getAttribute('aria-expanded')!=='true'; menu.setAttribute('aria-expanded',String(open)); nav.classList.toggle('open',open);menu.textContent=open?'Close':'Menu';});
function closeMenu(){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.textContent='Menu';}
nav.querySelectorAll('a').forEach(link => link.addEventListener('click',closeMenu));
document.querySelector('.mobile-order').addEventListener('click',closeMenu);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav.classList.contains('open')){closeMenu();menu.focus();}});
document.addEventListener('click',event=>{if(!event.target.closest('.sidebar'))closeMenu();});
function selectItems(items){
 if(!Array.isArray(items)||items.some(item=>!checks.some(c=>c.value===item))) throw new Error('Choose a listed product.');
 if (!thanks.hidden) startNewOrder();
 checks.forEach(c=>{c.checked=items.includes(c.value)});
 document.querySelector('#order').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 return {selected:checks.filter(c=>c.checked).map(c=>c.value),status:'Order request started. Complete the form and select Place order to send your request.'};
}
document.querySelectorAll('.pick').forEach(button=>button.addEventListener('click',()=>{selectItems([...new Set([...checks.filter(c=>c.checked).map(c=>c.value),button.dataset.item])]);if(window.matchMedia('(min-width: 1001px)').matches)document.querySelector(button.dataset.item==='Specific golf ball request'?'#specific-balls':'#customer').focus({preventScroll:true});}));
const submitButton = document.querySelector('#place-order');
const thanks = document.querySelector('#order-thanks');
let requestId = null;
let submitting = false;
let orderingAvailable = false;
async function checkOrdering() {
  try {
    const response = await fetch('/api/order-status', {cache: 'no-store'});
    const result = await response.json();
    orderingAvailable = response.ok && result.available === true;
  } catch { orderingAvailable = false; }
  if (!orderingAvailable) status.textContent = 'Online ordering is being connected. Please email maxxxbutler2000@gmail.com for now.';
  return orderingAvailable;
}
checkOrdering();
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !form.reportValidity()) return;
  const items = checks.filter(c => c.checked).map(c => c.value);
  if (!items.length && !form.elements.specificBalls.value.trim()) {
    status.textContent = 'Please choose an item or tell me which specific golf balls you’d like.';
    checks[0].focus(); return;
  }
  if (!orderingAvailable && !await checkOrdering()) return;
  requestId ||= crypto.randomUUID();
  const order = {
    customer: form.elements.customer.value.trim(), email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim(), items,
    specificBalls: form.elements.specificBalls.value.trim(), details: form.elements.details.value.trim(),
    delivery: form.elements.delivery.value.trim(), website: form.elements.website.value
  };
  submitting = true;
  submitButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submitButton.textContent = 'Sending your request…';
  status.textContent = 'Sending your order details to Maxx…';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': requestId},
      body: JSON.stringify(order), signal: AbortSignal.timeout(25000)
    });
    const result = await response.json();
    if (!response.ok || result.accepted !== true) {
      if (response.status === 400) requestId = null;
      throw new Error(result.error || 'Your request could not be sent. Please try again.');
    }
    form.hidden = true;
    thanks.hidden = false;
    document.querySelector('#order-reference').textContent = `Request reference: ${result.orderId.slice(0, 8)}`;
    document.querySelector('#thanks-title').focus({preventScroll: true});
    thanks.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'});
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
      ? 'We couldn’t confirm your submission. Keep your details here and try again—we’ll check the same request. You can also email Maxx directly.'
      : error.message;
  } finally {
    submitting = false; submitButton.disabled = false;
    form.removeAttribute('aria-busy'); submitButton.textContent = 'Place order';
  }
});
function startNewOrder() {
  form.reset(); requestId = null; status.textContent = ''; thanks.hidden = true; form.hidden = false;
}
document.querySelector('#another-order').addEventListener('click', () => {
  startNewOrder(); document.querySelector('#customer').focus();
});
const links=[...nav.querySelectorAll('a')];
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){links.forEach(a=>{const active=a.hash==='#'+entry.target.id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}},{rootMargin:'-15% 0px -60% 0px',threshold:0});links.forEach(a=>{const el=document.querySelector(a.hash);if(el)observer.observe(el);});}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();try{Promise.resolve(document.modelContext.registerTool({name:'start_order_request',title:'Start an order request',description:'Select products in the visible order form. Does not submit or confirm an order.',inputSchema:{type:'object',properties:{items:{type:'array',items:{type:'string',enum:checks.map(c=>c.value)},minItems:1}},required:['items'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!Array.isArray(input.items)||!input.items.length)throw new Error('Select at least one product.');return selectItems(input.items);}},{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
