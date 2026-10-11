const trade = { qty: 1.0 };
const totalQty = 0; // order.q || '0'
const filledQty = 0.4; // order.z || '0'
const remainingQty = totalQty - filledQty; // roundEight

const newQty = trade.qty - 0.4; // order.l || '0'

console.log(remainingQty, newQty);
