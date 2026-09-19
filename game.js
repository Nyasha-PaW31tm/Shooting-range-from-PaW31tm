/* ═══════════════════════════════════════════════════════════════
   ТИР — BETA 0.6 — логика игры
   ═══════════════════════════════════════════════════════════════ */
const $=id=>document.getElementById(id);
const range=$("range"),rifle=$("rifle"),rifleWrap=$("rifleWrap"),flash=$("muzzleFlash"),laser=$("laser");
const scoreEl=$("score"),comboEl=$("combo"),ultEl=$("ult"),ultBtn=$("ultimate");
const endScreen=$("endScreen");

let game=false,score=0,comboHits=0,ultHits=0,targets=[],bullets=[],nextId=1,spawnTimer=null,raf=null;
let aimX=50,aimY=40,laserEnabled=false;

/* ★ Следим за ростом целой части комбо-множителя.
   Когда множитель переходит 2.0 → 3.0 и т.д., показываем
   золотой текст. Сбрасывается при старте и при потере комбо. */
let prevComboFloor = 1;

/* ═══════════════════════════════════════════════════════════════
   ★ TELEGRAM WEBAPP
   ═══════════════════════════════════════════════════════════════ */
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#11161e');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#090c11');
}

/* ═══════════════════════════════════════════════════════════════
   ★ ССЫЛКА НА СТИКЕРПАК — замени на свой
   ═══════════════════════════════════════════════════════════════ */
const STICKER_PACK_URL = 'https://t.me/addstickers/YOUR_PACK_NAME';

/* ═══════════════════════════════════════════════════════════════
   ★ СТАТИСТИКА ЗАБЕГА
   ═══════════════════════════════════════════════════════════════ */
let runStats = {
  shotCount: 0,
  ultCount: 0,
  maxComboMult: 1,
  startTime: 0,
  duration: 0
};

/* ═══════════════════════════════════════════════════════════════
   ★★★ ЗВУКИ ★★★
   ═══════════════════════════════════════════════════════════════ */
const SFX = {
  shot: new Audio('sounds/fire.mp3'),
  hit:  new Audio('sounds/armor.mp3'),
  ult:  new Audio('sounds/series_of_shots.mp3'),
  win:  new Audio('sounds/win.mp3'),
  miss: new Audio('sounds/miss.mp3'),
};

let masterVolume = 0.7;

function playSfx(name){
  const a = SFX[name];
  if (!a || masterVolume <= 0) return;
  try {
    a.currentTime = 0;
    a.volume = masterVolume;
    a.play().catch(()=>{});
  } catch(e){}
}

/* ═══════════════════════════════════════════════════════════════
   ★ ОЧКИ ЗА МИШЕНИ
   ═══════════════════════════════════════════════════════════════ */
const TYPES={
  normal:   {base: 25, hp:1, speed:  0, color:"normal"},
  fast:     {base: 55, hp:1, speed:150, color:"fast"},
  armored:  {base: 80, hp:2, speed:  0, color:"armored"},
  maneuver: {base:120, hp:1, speed: 70, color:"maneuver"},
  gold:     {base:200, hp:1, speed:  0, color:"gold"},
  fastgold: {base:350, hp:1, speed:  0, color:"gold fastgold"}
};

/* ═══════════════════════════════════════════════════════════════
   ★ ШАНСЫ ПОЯВЛЕНИЯ МИШЕНЕЙ
   ═══════════════════════════════════════════════════════════════ */
function difficulty(){
  if(score<=1750)return{normal:.40,fast:.35,maneuver:.15,armored:.09,gold:.008,fastgold:.002};
  const t=Math.min(1,(score-1750)/8250);
  return{normal:.40-.30*t,fast:.35+.11*t,maneuver:.15+.12*t,armored:.09+.07*t,gold:.008,fastgold:.002};
}

function comboMult(){return 1+Math.max(0,comboHits-1)*.1}

function updateUI(){
  scoreEl.textContent=Math.floor(score);
  comboEl.textContent="×"+comboMult().toFixed(1);
  ultEl.textContent=ultHits+"/5";
  ultBtn.classList.toggle("ready",ultHits>=5);
  if(comboMult() > runStats.maxComboMult) runStats.maxComboMult = comboMult();
}

function freePoints(){return Math.max(0,5-targets.reduce((n,t)=>n+t.slots,0))}
function pickType(){const p=difficulty(),r=Math.random();let s=0;for(const k of Object.keys(p)){s+=p[k];if(r<s)return k}return"normal"}
function validType(type){
  if(type==="gold"||type==="fastgold")return targets.filter(t=>t.gold).length<2&&freePoints()>=(type==="fastgold"?2:1);
  return freePoints()>=1;
}

function spawn(){
  if(!game||targets.length>=5)return;
  let type=null;
  for(let i=0;i<30;i++){let x=pickType();if(validType(x)){type=x;break}}
  if(!type)return;

  const d=TYPES[type];
  const gold=type==="gold"||type==="fastgold";
  const slots=type==="fastgold"?2:1;
  const lane=Math.floor(Math.random()*3);
  const laneSlots=targets.filter(t=>t.lane===lane).reduce((n,t)=>n+t.slots,0);
  if(laneSlots+slots>2){setTimeout(spawn,120);return}

  const el=document.createElement("div");
  el.className="target "+d.color;
  const t={
    id:nextId++, type, lane,
    x: type==="fastgold"?50:12+Math.random()*76,
    y:50, hp:d.hp, slots, gold, el,
    dx: type==="fast"?(Math.random()<.5?1:-1)*d.speed
      : type==="maneuver"?(Math.random()<.5?1:-1)*d.speed
      : 0,
    last:performance.now(),
    jumpAt:performance.now()+1200+Math.random()*1500,
    telegraphing:false
  };
  el.style.left=t.x+"%";el.style.top=t.y+"%";el.dataset.id=t.id;
  if(t.hp>1){let hp=document.createElement("div");hp.className="hp";hp.textContent="HP 2/2";el.appendChild(hp)}
  document.querySelectorAll(".lane")[lane].appendChild(el);
  targets.push(t);
}
function removeTarget(t){t.el.remove();targets=targets.filter(x=>x!==t)}

/* ★ Штраф лазера: 0.75 = −25%. */
function addScore(points){score+=points*(laserEnabled?.75:1)}

/* ═══════════════════════════════════════════════════════════════
   ★★★ СПЕЦЭФФЕКТЫ ★★★
   ═══════════════════════════════════════════════════════════════ */

/* Возвращает координаты центра элемента в системе #range */
function getElCenter(el){
  const tr = el.getBoundingClientRect();
  const r  = range.getBoundingClientRect();
  return {
    x: tr.left + tr.width/2 - r.left,
    y: tr.top  + tr.height/2 - r.top
  };
}

/* ★ ЭФФЕКТ 1: разлёт мишени на осколки.

   НАСТРОЙКИ (можно менять):
   - count: количество осколков. Сейчас 4-5 случайно.
   - dist:  дистанция разлёта. Сейчас 45-90 px.
   - размер осколков задаётся в CSS (.shard width/height). */
function shatterTarget(el, x, y){
  const color = getComputedStyle(el).backgroundColor;
  const count = 4 + Math.floor(Math.random() * 2);   // ★ 4-5 осколков

  for (let i = 0; i < count; i++){
    const shard = document.createElement('div');
    shard.className = 'shard';
    shard.style.left = x + 'px';
    shard.style.top  = y + 'px';
    shard.style.background = color;

    // Размер осколка — случайный для естественности
    const size = 8 + Math.random() * 8;
    shard.style.width  = size + 'px';
    shard.style.height = size + 'px';

    // Угол разлёта: равномерно по кругу + немного шума
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist  = 45 + Math.random() * 45;            // ★ дистанция

    shard.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    shard.style.setProperty('--dy', Math.sin(angle) * dist + 'px');

    range.appendChild(shard);
    setTimeout(() => shard.remove(), 650);
  }
}

/* ★ ЭФФЕКТ 2: золотой текст "×N.0" при росте множителя.

   Показывается ТОЛЬКО при переходе на новую целую часть:
   ×1.0 → ×2.0 → ×3.0 и т.д. Формула комбо: 1 + (hits-1)*0.1,
   так что ×2.0 достигается при 11 попаданиях подряд,
   ×3.0 — при 21, ×4.0 — при 31 и т.д. */
function showGoldCombo(x, y, mult){
  const el = document.createElement('div');
  el.className = 'combo-pop';
  el.textContent = '×' + mult.toFixed(1);
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  range.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

/* ═══════════════════════════════════════════════════════════════
   ПОПАДАНИЕ (с эффектами)
   ═══════════════════════════════════════════════════════════════ */
function hitTarget(t){
  playSfx('hit');
  t.hp--;
  const alive = t.hp > 0;

  if (alive){
    let hp = t.el.querySelector(".hp");
    if (hp) hp.textContent = "HP 1/2";
  } else {
    addScore(TYPES[t.type].base * comboMult());
  }

  comboHits++;
  ultHits = Math.min(5, ultHits + 1);

  // ★ ЭФФЕКТ 1: разлёт осколков при убийстве
  let center = null;
  if (!alive){
    center = getElCenter(t.el);
    shatterTarget(t.el, center.x, center.y);
  }

  // ★ ЭФФЕКТ 2: золотая подсветка при росте целой части множителя
  const newFloor = Math.floor(comboMult());
  if (newFloor > prevComboFloor){
    prevComboFloor = newFloor;
    const c = center || getElCenter(t.el);
    showGoldCombo(c.x, c.y, newFloor);
  }

  if (!alive) removeTarget(t);
  updateUI();
}

function miss(){
  playSfx('miss');
  comboHits = 0;
  prevComboFloor = 1;   // ★ сброс счётчика золотых подсветок
  updateUI();
}

/* ═══════════════════════════════════════════════════════════════
   ПРИЦЕЛ
   ═══════════════════════════════════════════════════════════════ */
function setAim(clientX,clientY){
  const r=range.getBoundingClientRect();
  aimX=Math.max(8,Math.min(92,(clientX-r.left)/r.width*100));
  aimY=Math.max(5,Math.min(62,(clientY-r.top)/r.height*100));
  updateRifle();
}

function getAimGeom(){
  const r=range.getBoundingClientRect();
  const pivotX=r.width/2, pivotY=r.height-18;
  const tx=aimX/100*r.width, ty=aimY/100*r.height;
  const angle=Math.atan2(tx-pivotX,pivotY-ty)*180/Math.PI;
  const mx=pivotX+Math.sin(angle*Math.PI/180)*176;
  const my=pivotY-Math.cos(angle*Math.PI/180)*176;
  return {pivotX,pivotY,tx,ty,angle,mx,my};
}

function updateRifle(){
  const g=getAimGeom();
  rifle.style.transform=`rotate(${g.angle}deg)`;
  flash.style.left=g.mx+"px";
  flash.style.top=g.my+"px";
  laser.style.left=g.pivotX+"px";
  laser.style.top=g.pivotY+"px";
  laser.style.width=Math.hypot(g.tx-g.pivotX,g.ty-g.pivotY)+"px";
  laser.style.transform=`rotate(${Math.atan2(g.ty-g.pivotY,g.tx-g.pivotX)}rad)`;
  laser.classList.toggle("hidden",!laserEnabled||!game);
}

function isOnHomeBtn(e){
  let el = e.target;
  while(el && el !== range){
    if(el.id === 'homeBtn') return true;
    el = el.parentElement;
  }
  return false;
}

range.addEventListener("pointerdown",e=>{
  if(!game) return;
  if(isOnHomeBtn(e)) return;
  range.setPointerCapture(e.pointerId);
  setAim(e.clientX,e.clientY);
});
range.addEventListener("pointermove",e=>{
  if(!game) return;
  if(isOnHomeBtn(e)) return;
  if(e.buttons) setAim(e.clientX,e.clientY);
});

/* ═══════════════════════════════════════════════════════════════
   ПУЛЯ
   ═══════════════════════════════════════════════════════════════ */
function spawnBullet(){
  const g=getAimGeom();
  const dx=g.tx-g.mx, dy=g.ty-g.my;
  const dist=Math.hypot(dx,dy);
  const angle=Math.atan2(dy,dx)*180/Math.PI;
  const b=document.createElement("div");
  b.className="bullet";
  b.style.left=g.mx+"px";
  b.style.top=g.my+"px";
  b.style.setProperty("--dx",dx+"px");
  b.style.setProperty("--dy",dy+"px");
  b.style.setProperty("--angle",(angle+90)+"deg");
  b.style.animation=`bulletTravel ${Math.max(.09,Math.min(.28,dist/1700))}s linear forwards`;
  range.appendChild(b);
  bullets.push(b);
  setTimeout(()=>{b.remove();bullets=bullets.filter(x=>x!==b)},320);
}

/* ═══════════════════════════════════════════════════════════════
   ВЫСТРЕЛ
   ═══════════════════════════════════════════════════════════════ */
function fire(){
  if(!game)return;
  runStats.shotCount++;
  playSfx('shot');

  rifleWrap.classList.remove("recoil");void rifleWrap.offsetWidth;rifleWrap.classList.add("recoil");
  flash.classList.remove("fire");void flash.offsetWidth;flash.classList.add("fire");
  spawnBullet();

  const r=range.getBoundingClientRect();
  const tx=aimX/100*r.width, ty=aimY/100*r.height;
  let hit=null,best=1e9;
  for(const t of targets){
    const tr=t.el.getBoundingClientRect();
    const cx=tr.left+tr.width/2-r.left, cy=tr.top+tr.height/2-r.top;
    const dist=Math.hypot(tx-cx,ty-cy);
    const rad=Math.max(tr.width,tr.height)/2;
    if(dist<=rad&&dist<best){best=dist;hit=t}
  }
  if(hit)hitTarget(hit);else miss();
}

/* ═══════════════════════════════════════════════════════════════
   ULT
   ═══════════════════════════════════════════════════════════════ */
function ultimate(){
  if(!game||ultHits<5)return;
  runStats.ultCount++;
  playSfx('ult');

  // Разлетаем все мишени одновременно
  [...targets].forEach(t => {
    const c = getElCenter(t.el);
    shatterTarget(t.el, c.x, c.y);
  });

  let total=0;
  [...targets].forEach(t=>{total+=TYPES[t.type].base;removeTarget(t)});
  addScore(total*comboMult()*3);
  ultHits=0;updateUI();
  const msg=$("message");
  msg.textContent="ULT ×3";msg.className="pop";
  setTimeout(()=>{msg.textContent="";msg.className=""},600);
}

/* ═══════════════════════════════════════════════════════════════
   СОХРАНЕНИЕ РЕЗУЛЬТАТА (последние 10 забегов)
   ═══════════════════════════════════════════════════════════════ */
function saveRunResult(win){
  try {
    const history = JSON.parse(localStorage.getItem('tir_history') || '[]');
    history.unshift({
      score: Math.floor(score),
      win: win,
      duration: runStats.duration,
      shots: runStats.shotCount,
      ults: runStats.ultCount,
      maxCombo: +runStats.maxComboMult.toFixed(1),
      date: new Date().toLocaleDateString('ru-RU')
    });
    localStorage.setItem('tir_history', JSON.stringify(history.slice(0, 10)));
  } catch(err){
    console.error("[tir] Ошибка сохранения истории:", err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   МОСТ МЕЖДУ МЕНЮ (iframe) И ИГРОЙ
   ═══════════════════════════════════════════════════════════════ */
const menuFrame=$("menuFrame");

/* ═══════════════════════════════════════════════════════════════
   СТАРТ ИГРЫ
   ═══════════════════════════════════════════════════════════════ */
function startGame(){
  score=0;comboHits=0;ultHits=0;targets=[];
  bullets.forEach(b=>b.remove());bullets=[];
  nextId=1;game=true;
  prevComboFloor = 1;   // ★ сброс золотых подсветок
  runStats = { shotCount:0, ultCount:0, maxComboMult:1, startTime:performance.now(), duration:0 };
  updateUI();
  endScreen.classList.add("hidden");
  document.querySelectorAll(".target").forEach(e=>e.remove());
  aimX=50;aimY=40;updateRifle();

  $("homeBtn").classList.remove("hidden");
  $("stickerBtn").classList.add("hidden");

  for(let i=0;i<3;i++)setTimeout(spawn,250+i*250);
  clearInterval(spawnTimer);
  spawnTimer=setInterval(()=>{if(game)spawn()},1000);
  cancelAnimationFrame(raf);
  raf=requestAnimationFrame(loop);
}

function finish(win){
  game=false;clearInterval(spawnTimer);
  laser.classList.add("hidden");
  $("homeBtn").classList.add("hidden");

  if(win) playSfx('win');

  runStats.duration = Math.round((performance.now() - runStats.startTime) / 1000);
  saveRunResult(win);

  $("endTitle").textContent=win?"ПОБЕДА!":"ИГРА ОКОНЧЕНА";
  $("endReason").textContent=win
    ?"10 000 очков достигнуто. Забери награду!"
    :"Игра завершена.";
  $("finalScore").textContent=Math.floor(score);
  $("stickerBtn").classList.toggle("hidden", !win);
  endScreen.classList.remove("hidden");
}

function exitToMenu(){
  if(!game) return;

  runStats.duration = Math.round((performance.now() - runStats.startTime) / 1000);
  saveRunResult(false);

  game = false;
  clearInterval(spawnTimer);
  cancelAnimationFrame(raf);

  [...targets].forEach(t => t.el.remove());
  targets = [];
  bullets.forEach(b => b.remove());
  bullets = [];

  laser.classList.add("hidden");
  $("homeBtn").classList.add("hidden");

  try {
    menuFrame.style.display = "block";
    if (menuFrame.contentWindow){
      menuFrame.contentWindow.postMessage({source:"game",type:"resetUI"},"*");
    }
  } catch(err){
    console.error("[tir] Ошибка при показе меню:", err);
  }

  updateRifle();
}

/* ═══════════════════════════════════════════════════════════════
   ГЛАВНЫЙ ЦИКЛ
   ═══════════════════════════════════════════════════════════════ */
function loop(now){
  if(!game)return;
  for(const t of [...targets]){
    const dt=(now-t.last)/1000;t.last=now;

    if(t.dx){
      const rr=range.getBoundingClientRect();
      t.x+=t.dx*dt/rr.width*100;
      if(t.x<5||t.x>95){t.dx*=-1;t.x=Math.max(5,Math.min(95,t.x))}
      t.el.style.left=t.x+"%";
    }

    if(t.type==="maneuver"&&now>t.jumpAt){
      if(!t.telegraphing){
        t.telegraphing=true;
        t.el.classList.remove("telegraph");void t.el.offsetWidth;
        t.el.classList.add("telegraph");
        t.jumpAt=now+450;
      }else{
        t.telegraphing=false;
        t.el.classList.remove("telegraph");
        t.el.classList.remove("jumping");void t.el.offsetWidth;
        t.el.classList.add("jumping");
        t.lane=(t.lane+1+Math.floor(Math.random()*2))%3;
        const laneSlots=targets.filter(x=>x!==t&&x.lane===t.lane).reduce((n,x)=>n+x.slots,0);
        if(laneSlots+t.slots<=2)document.querySelectorAll(".lane")[t.lane].appendChild(t.el);
        else t.lane=(t.lane+2)%3;
        t.jumpAt=now+1300+Math.random()*1500;
      }
    }
  }

  if(score>=10000)finish(true);
  else{updateRifle();raf=requestAnimationFrame(loop)}
}

/* ═══════════════════════════════════════════════════════════════
   КНОПКИ ИГРЫ
   ═══════════════════════════════════════════════════════════════ */
$("fire").onclick=fire;
$("ultimate").onclick=ultimate;
$("again").onclick=startGame;

const homeBtn = $("homeBtn");
homeBtn.addEventListener("pointerdown", e => { e.stopPropagation(); }, true);
homeBtn.addEventListener("pointerup", e => {
  e.stopPropagation();
  e.preventDefault();
  exitToMenu();
});
homeBtn.addEventListener("click", e => {
  e.stopPropagation();
  e.preventDefault();
  exitToMenu();
});

document.addEventListener("click", e => {
  const t = e.target;
  if(t && (t.id === "homeBtn" || (t.closest && t.closest("#homeBtn")))){
    exitToMenu();
  }
}, true);

$("backMenu").onclick=()=>{
  endScreen.classList.add("hidden");
  menuFrame.style.display="block";
  menuFrame.contentWindow.postMessage({source:"game",type:"resetUI"},"*");
  updateRifle();
};

$("stickerBtn").onclick = () => {
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(STICKER_PACK_URL);
  } else {
    window.open(STICKER_PACK_URL, '_blank');
  }
};

/* ═══════════════════════════════════════════════════════════════
   ПРИЁМ СООБЩЕНИЙ ИЗ МЕНЮ
   ═══════════════════════════════════════════════════════════════ */
window.addEventListener("message",(e)=>{
  if(!e.data||e.data.source!=="menu")return;
  switch(e.data.type){
    case "startGame":
      startGame();
      menuFrame.style.display="none";
      break;
    case "setLaser":
      laserEnabled=e.data.payload;
      if(game)updateRifle();
      break;
    case "setVolume":
      masterVolume=e.data.payload;
      break;
    case "setBackground":
      document.body.dataset.bg=e.data.payload;
      break;
  }
});

/* ═══════════════════════════════════════════════════════════════
   ЗАГРУЗКА СОХРАНЁННЫХ НАСТРОЕК
   ═══════════════════════════════════════════════════════════════ */
const _savedBg = localStorage.getItem('tir_bg') || 'dark';
document.body.dataset.bg = _savedBg;
const _savedVol = localStorage.getItem('tir_volume');
if(_savedVol !== null) masterVolume = +_savedVol / 100;

updateUI();
updateRifle();
