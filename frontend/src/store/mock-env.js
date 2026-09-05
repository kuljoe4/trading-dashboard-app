const localStore = {};
global.localStorage = {
  getItem: (key) => localStore[key] ?? null,
  setItem: (key, val) => { localStore[key] = String(val); },
  removeItem: (key) => { delete localStore[key]; },
  clear: () => { Object.keys(localStore).forEach(k => delete localStore[k]); }
};

const sessionStore = {};
global.sessionStorage = {
  getItem: (key) => sessionStore[key] ?? null,
  setItem: (key, val) => { sessionStore[key] = String(val); },
  removeItem: (key) => { delete sessionStore[key]; },
  clear: () => { Object.keys(sessionStore).forEach(k => delete sessionStore[k]); }
};
