import { WORLD, FOOD_TYPES, POWERUPS, SKINS, THEMES, BOT_NAMES, MODES } from './config.js';
import { clamp, clampZoom, distance, angleTo, angleLerp, random, weightedPick, segmentsForMass, formatNumber, spawnProtectionRemaining, canWormsCollide, trailFoodPositions, newWormSpawnMass, displayText, foodMassGain } from './logic.js';
import { createWorm, updateWormTrail, bodyPoints, drawWorm } from './worm.js';
import { Camera } from './camera.js';
import { chooseBotAngle } from './ai.js';
import { createFood, foodAttract, getWormMouthPoint } from './food.js';
import { bodyHitsTrail, touchesWorldWall } from './collision.js';
import { activatePowerup, expirePowerups, powerupIsActive } from './powerups.js';
import { createParticleBurst, stepParticles } from './particles.js';

const _foodSpriteCache = new Map();
function getFoodSprite(type, r, style) {
  const key = `${type.emoji}|${Math.round(r)}|${style}`;
  let cached = _foodSpriteCache.get(key);
  if (cached) return cached;
  const pad = style === 'sparkle' ? 14 : 8;
  const size = Math.ceil((r + pad) * 2);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  if (style === 'sparkle') {
    g.shadowBlur = 10;
    g.shadowColor = '#fff4a8';
  }
  if (style === 'fruit party') {
    g.beginPath();
    g.arc(cx, cy, r + 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,111,178,.25)';
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy + 2, r + 2, 0, Math.PI * 2);
  g.fillStyle = 'rgba(48,67,42,.16)';
  g.fill();
  g.shadowBlur = 0;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = type.color;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.stroke();
  g.font = `${Math.max(10, Math.round(r * 1.45))}px system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(type.emoji, cx, cy + 1);
  cached = { canvas: c, half: size / 2 };
  _foodSpriteCache.set(key, cached);
  return cached;
}

export class Game {
  constructor(canvas, {onUpdate=()=>{}, onGameOver=()=>{}, onNotice=()=>{}, onSound=()=>{}}={}) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});this.onUpdate=onUpdate;this.onGameOver=onGameOver;this.onNotice=onNotice;this.onSound=onSound;
    this.camera=new Camera();this.state='menu';this.mode='classic';this.save=null;this.player=null;this.bots=[];this.food=[];this.powerItems=[];this.coins=[];this.particles=[];
    this.elapsed=0;this.last=0;this.acc=0;this.raf=0;this.viewZoom=1;this.frame=0;this.timeLeft=180;this.arenaRadius=1120;this.totalScore=0;this.startedAt=0;this.bestMass=0;this.kills=0;this.foodEaten=0;this.coinsEarned=0;this.gemsEarned=0;this.powerupsCollected=0;this.lastCollectSound=0;this.boost=false;this.pointerAngle=0;this.lastBoostDrop=0;this.notifyTimer=0;this.currentTheme=THEMES[0];this.lastSummary=null;this.runFinalized=false;
    this.dpr=1;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
    this.resize();
  }
  getEffectiveDpr(){
    const q = this.save?.settings?.quality || 'auto';
    const raw = window.devicePixelRatio || 1;
    if (q === 'low') return 1;
    if (q === 'high') return Math.min(raw, 1.75);
    return Math.min(raw, 1.35);
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();
    const dpr=this.getEffectiveDpr();
    this.dpr=dpr;
    this.canvas.width=Math.max(1,Math.floor(rect.width*dpr));this.canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    this.ctx.setTransform(dpr,0,0,dpr,0,0);this.cssWidth=rect.width;this.cssHeight=rect.height;
  }
  start(mode='classic',save){
    this.mode=mode;this.save=save;this.state='playing';this.elapsed=0;this.timeLeft=180;this.arenaRadius=1120;this.totalScore=0;this.kills=0;this.foodEaten=0;this.coinsEarned=0;this.gemsEarned=0;this.powerupsCollected=0;this.lastCollectSound=0;this.bestMass=0;this.frame=0;this.particles=[];this.coins=[];this.lastSummary=null;this.runFinalized=false;
    this.resize();
    this.currentTheme=THEMES.find(t=>t.id===save.selectedTheme)||THEMES[0];
    const mass=mode==='giant'?360:30;
    this.player=createWorm({x:WORLD.width/2,y:WORLD.height/2,angle:Math.random()*Math.PI*2,name:save.username||'Player',skin:SKINS[save.selectedSkin]||SKINS[0],player:true,mass});
    this.player.spawnProtectedUntil=this.elapsed+3;
    const botCount=Math.min(34,Math.max(24,Math.floor((this.cssWidth*this.cssHeight)/28000)));
    this.bots=[];
    for(let i=0;i<botCount;i++) this.bots.push(this.makeBot(i));
    this.food=[];for(let i=0;i<460;i++)this.spawnFood();
    this.powerItems=[];for(let i=0;i<12;i++)this.spawnPower();
    this.camera.x=this.player.x;this.camera.y=this.player.y;this.startedAt=performance.now();
    this.onNotice(MODES.find(m=>m.id===mode)?.name||'Classic Endless');
    this.onUpdate(this.getStats());
    if(!this.raf)this.loop();
  }
  makeBot(index){
    const angle=random(0,Math.PI*2),rad=random(230,900);const x=clamp(WORLD.width/2+Math.cos(angle)*rad,100,WORLD.width-100);const y=clamp(WORLD.height/2+Math.sin(angle)*rad,100,WORLD.height-100);
    const skin=SKINS[Math.floor(Math.random()*SKINS.length)];
    const bot=createWorm({x,y,angle:random(-Math.PI,Math.PI),name:`${BOT_NAMES[index%BOT_NAMES.length]}${index>=BOT_NAMES.length?` ${Math.floor(index/BOT_NAMES.length)+1}`:''}`,skin,player:false,mass:this.mode==='giant'?random(60,130):newWormSpawnMass(),ai:index});
    bot.think=Math.random();bot.spawnProtectedUntil=this.elapsed+3;return bot;
  }
  spawnFood(x=random(70,WORLD.width-70),y=random(70,WORLD.height-70),forcedType=null){
    const type=forcedType||weightedPick(FOOD_TYPES);
    this.food.push(createFood(x,y,type,Math.random()*6.28));
  }
  spawnPower(){
    const type=POWERUPS[Math.floor(Math.random()*POWERUPS.length)];
    this.powerItems.push({x:random(100,WORLD.width-100),y:random(100,WORLD.height-100),r:19,type,phase:Math.random()*6.28});
  }
  addParticles(x,y,color,count=6){
    if(this.save?.workshop?.particles===false)return;
    if(this.particles.length>140)return;
    this.particles.push(...createParticleBurst(x,y,color,count));
  }
  loop=(now=performance.now())=>{
    if(!this.raf&&this.state==='menu') return;
    const dt=Math.min(.035,Math.max(0,(now-(this.last||now))/1000));this.last=now;
    if(this.state==='playing') this.update(dt);
    this.render(now);this.raf=requestAnimationFrame(this.loop);
  }
  stopLoop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.last=0;}
  pause(){if(this.state==='playing'){this.state='paused';this.onUpdate(this.getStats());}}
  resume(){if(this.state==='paused'){this.state='playing';this.last=performance.now();}}
  setSteering(angle){if(Number.isFinite(angle))this.pointerAngle=angle;}
  setBoost(active){this.boost=!!active;}
  setZoom(value){this.viewZoom=clampZoom(value);return this.viewZoom;}
  zoomBy(delta){return this.setZoom(this.viewZoom+delta);}
  getStats(){return {score:this.totalScore,mass:this.player?.mass||0,length:this.player?segmentsForMass(this.player.mass,this.player.food||0):0,rank:this.getRank(),time:this.elapsed,kills:this.kills,food:this.foodEaten,coins:this.coinsEarned,gems:this.gemsEarned,timeLeft:this.timeLeft,mode:this.mode,powerups:this.player?.powerups||{},powerupsCollected:this.powerupsCollected};}
  getRank(){if(!this.player)return 0;return 1+this.bots.filter(b=>b.alive&&b.mass>this.player.mass).length;}
  isPowerActive(id){return powerupIsActive(this.player,id,this.elapsed);}
  update(dt){
    this.elapsed+=dt;this.frame++;
    if(this.mode==='time'){this.timeLeft=Math.max(0,180-this.elapsed);if(this.timeLeft<=0){this.end('time');return;}}
    if(this.mode==='battle'){
      this.arenaRadius=Math.max(300,1120-this.elapsed*5.3);
      const dx=this.player.x-WORLD.width/2, dy=this.player.y-WORLD.height/2;
      if(dx*dx+dy*dy>this.arenaRadius*this.arenaRadius){this.damagePlayer('arena');if(this.state!=='playing')return;}
    }
    if(this.mode==='survival'&&this.elapsed>45){for(const b of this.bots)b.baseSpeed=Math.min(190,b.baseSpeed+dt*.25);}
    this.updatePlayer(dt);
    for(let i=0;i<this.bots.length;i++){
      const bot=this.bots[i];
      if(bot.alive)this.updateBot(bot,dt);
      else if(this.mode!=='battle'&&this.elapsed>bot.respawnAt){this.bots[i]=this.makeBot(i);}
    }
    if(this.mode==='battle'&&this.bots.every(bot=>!bot.alive)){this.end('victory');return;}
    if((this.frame&1)===0)this.updateFood();
    this.updatePowerups();this.updateCoins(dt);this.updateParticles(dt);this.checkCollisions();
    if(this.state!=='playing')return;
    if(this.food.length<520){for(let i=0;i<Math.min(6,520-this.food.length);i++)this.spawnFood();}
    if(this.powerItems.length<13&&Math.random()<dt*.8)this.spawnPower();
    const cameraZoom=this.isPowerActive('zoom')?Math.max(.65,this.viewZoom*.84):this.viewZoom;
    this.camera.follow(this.player,this.canvas,{width:WORLD.width,height:WORLD.height},dt,cameraZoom);
    this.bestMass=Math.max(this.bestMass,this.player.mass);
    if(this.frame%10===0)this.onUpdate(this.getStats());
  }
  steerAwayFromWalls(worm,angle){
    const margin=200;let desired=angle;
    if(worm.x<margin)desired=angleLerp(desired,0,.5);
    if(worm.x>WORLD.width-margin)desired=angleLerp(desired,Math.PI,.5);
    if(worm.y<margin)desired=angleLerp(desired,Math.PI/2,.5);
    if(worm.y>WORLD.height-margin)desired=angleLerp(desired,-Math.PI/2,.5);
    return desired;
  }
  updatePlayer(dt){
    const p=this.player;if(!p)return;
    const useBoost=this.boost&&p.mass>18&&this.elapsed-p.lastDrop>.08;
    if(useBoost){p.mass=Math.max(18,p.mass-dt*5);if(this.elapsed-p.lastDrop>.55){this.spawnFood(p.x-Math.cos(p.angle)*20,p.y-Math.sin(p.angle)*20,{name:'Boost Crumb',emoji:'✨',color:'#fff1a6',value:8,weight:1});p.lastDrop=this.elapsed;}}
    const target=this.steerAwayFromWalls(p,this.pointerAngle);
    updateWormTrail(p,dt,target,WORLD,useBoost);
    this.collectForWorm(p,true);
    expirePowerups(p,this.elapsed);
  }
  updateBot(bot,dt){
    bot.think-=dt;
    if(bot.think<=0){
      bot.think=random(.22,.55);
      bot.targetAngle=chooseBotAngle(bot,[this.player,...this.bots],this.food,WORLD);
    }
    updateWormTrail(bot,dt,bot.targetAngle||bot.angle,WORLD,Math.random()<.006&&bot.mass>24);
    if(!this.isSpawnProtected(bot)&&touchesWorldWall(bot,WORLD,24)){this.killBot(bot,false,'wall');return;}
    this.collectForWorm(bot,false);
  }
  collectForWorm(worm,isPlayer){
    const magnet=isPlayer&&this.isPowerActive('magnet');
    const range=magnet?180:worm.r+14;
    for(let i=this.food.length-1;i>=0;i--){
      const f=this.food[i];
      const dx=worm.x-f.x, dy=worm.y-f.y;
      const hitDist=range+(f.r||6);
      if(dx*dx+dy*dy<hitDist*hitDist){
        this.food.splice(i,1);const mult=isPlayer&&this.isPowerActive('food')?2:1;const scoreMult=isPlayer&&this.isPowerActive('double')?2:1;
        worm.mass+=foodMassGain(f.type.value,mult);worm.score+=f.type.value*scoreMult;worm.food++;
        if(isPlayer){this.totalScore+=f.type.value*scoreMult;this.foodEaten++;this.coinsEarned+=Math.max(1,Math.round(f.type.value/30));if(this.elapsed%5<.1){this.save.xp+=Math.round(f.type.value/8)*(this.isPowerActive('xp')?2:1);}this.addParticles(f.x,f.y,f.type.color,4);if(this.elapsed-this.lastCollectSound>.12){this.onSound('collect');this.lastCollectSound=this.elapsed;}}
      }
    }
    if(isPlayer&&this.isPowerActive('gold')&&Math.random()<.003){this.spawnFood(worm.x+random(-180,180),worm.y+random(-180,180),FOOD_TYPES[15]);}
  }
  updateFood(){
    const livingWorms=[this.player,...this.bots.filter(bot=>bot.alive)].filter(Boolean);
    const mouths = livingWorms.map(w => ({ worm: w, mouth: getWormMouthPoint(w), magnet: w.player && this.isPowerActive('magnet') }));
    for(let i=0;i<this.food.length;i++){
      const food=this.food[i];
      food.phase+=.06;
      let nearest=null,nearestDistSq=Infinity;
      for(let j=0;j<mouths.length;j++){
        const m=mouths[j];
        const dx=m.mouth.x-food.x, dy=m.mouth.y-food.y;
        const dSq=dx*dx+dy*dy;
        if(dSq<nearestDistSq){nearest=m;nearestDistSq=dSq;}
      }
      if(!nearest)continue;
      const range=nearest.magnet?520:290;
      if(nearestDistSq<range*range)foodAttract(food,nearest.mouth,range,nearest.magnet?.14:.085);
    }
  }
  updatePowerups(){
    for(let i=this.powerItems.length-1;i>=0;i--){const item=this.powerItems[i];item.phase+=.04;
      if(distance(this.player,item)<this.player.r+item.r){this.powerItems.splice(i,1);activatePowerup(this.player,item.type,this.elapsed);this.powerupsCollected++;if(item.type.id==='xp')this.gemsEarned++;this.onSound('power');this.addParticles(item.x,item.y,item.type.color,14);this.onNotice(`${displayText(item.type.name)} ACTIVATED`);if(this.powerItems.length<9)this.spawnPower();}
    }
  }
  updateCoins(dt){
    const coinMag=this.isPowerActive('coin');
    for(let i=this.coins.length-1;i>=0;i--){const c=this.coins[i];c.life-=dt;if(coinMag&&distance(c,this.player)<230){c.x+=(this.player.x-c.x)*.08;c.y+=(this.player.y-c.y)*.08;}if(distance(c,this.player)<20){this.coinsEarned+=c.value;this.addParticles(c.x,c.y,'#ffda54',5);this.coins.splice(i,1);}else if(c.life<=0)this.coins.splice(i,1);}
  }
  updateParticles(dt){stepParticles(this.particles,dt);}
  bodyCollision(head,owner){return bodyHitsTrail(head,owner);}
  isSpawnProtected(worm){return spawnProtectionRemaining(worm,this.elapsed)>0;}
  drawSpawnShield(ctx,worm,now){
    if(!this.isSpawnProtected(worm))return;
    const points=[...bodyPoints(worm),{x:worm.x,y:worm.y}];
    const pulse=1+Math.sin(now*.012)*.045;
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
    ctx.strokeStyle='rgba(93,220,255,.38)';ctx.lineWidth=(worm.r+7)*2*pulse;ctx.stroke();
    ctx.beginPath();ctx.arc(worm.x,worm.y,(worm.r+12)*pulse,0,Math.PI*2);
    ctx.fillStyle='rgba(112,229,255,.14)';ctx.fill();ctx.strokeStyle='rgba(218,250,255,.95)';ctx.lineWidth=2.5;ctx.stroke();
    ctx.font='17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🛡️',worm.x+25,worm.y-25);
    ctx.restore();
  }
  checkCollisions(){
    const p=this.player;
    for(const b of this.bots){if(!b.alive)continue;
      if(!canWormsCollide(p,b,this.elapsed))continue;
      if(this.bodyCollision(p,b)){
        if(this.isPowerActive('shield')){delete p.powerups.shield;this.addParticles(p.x,p.y,'#7ceaff',14);this.onNotice('SHIELD BLOCKED A HIT');}
        else {this.end('collision');return;}
      }
      if(this.bodyCollision(b,p)){this.killBot(b,true,'rival');continue;}
    }
    if(this.frame%2===0){
      for(let i=0;i<this.bots.length;i++){
        const a=this.bots[i];if(!a.alive)continue;
        for(let j=i+1;j<this.bots.length;j++){
          const b=this.bots[j];if(!b.alive||!canWormsCollide(a,b,this.elapsed))continue;
          const aHitsB=this.bodyCollision(a,b);
          const bHitsA=this.bodyCollision(b,a);
          if(aHitsB)this.killBot(a,false,'rival');
          if(bHitsA)this.killBot(b,false,'rival');
          if(!a.alive)break;
        }
      }
    }
    if(!this.isSpawnProtected(p)&&(p.x<28||p.y<28||p.x>WORLD.width-28||p.y>WORLD.height-28)){this.end('wall');}
  }
  killBot(bot,credited,reason='rival'){
    if(!bot.alive)return;bot.alive=false;bot.deathReason=reason;bot.respawnAt=this.elapsed+1.4;
    const drops=Math.min(42,Math.max(10,Math.floor(segmentsForMass(bot.mass,bot.food||0)*.75)));
    const trailDrops=trailFoodPositions(bot,drops);
    trailDrops.forEach((point,i)=>this.spawnFood(point.x,point.y,i%11===0?FOOD_TYPES[15]:null));
    this.coins.push({x:bot.x,y:bot.y,value:8+Math.floor(bot.mass/35),life:18});this.addParticles(bot.x,bot.y,bot.skin.a,16);
    if(credited){this.kills++;this.player.kills++;this.onNotice('ENEMY ELIMINATED + COINS');}
  }
  damagePlayer(reason){if(this.isSpawnProtected(this.player)){this.onNotice('SPAWN SHIELD ACTIVE');return;}if(this.isPowerActive('shield')){delete this.player.powerups.shield;this.onNotice('SHIELD BLOCKED ARENA DAMAGE');this.player.x=clamp(this.player.x,WORLD.width/2-this.arenaRadius+60,WORLD.width/2+this.arenaRadius-60);this.player.y=clamp(this.player.y,WORLD.height/2-this.arenaRadius+60,WORLD.height/2+this.arenaRadius-60);}else this.end(reason);}
  end(reason){
    if(this.state!=='playing')return;
    this.state='gameover';this.boost=false;
    const summary={score:this.totalScore,mass:this.player.mass,length:segmentsForMass(this.player.mass,this.player.food||0),time:this.elapsed,kills:this.kills,food:this.foodEaten,coins:this.coinsEarned,powerups:this.powerupsCollected,reason,mode:this.mode};
    this.lastSummary=summary;
    this.onGameOver(summary);
  }
  continueAfterReward(){
    if(this.state!=='gameover'||!this.player||!this.lastSummary||!['collision','wall','arena'].includes(this.lastSummary.reason))return false;
    this.state='playing';this.boost=false;this.player.spawnProtectedUntil=this.elapsed+4;
    this.lastSummary=null;this.runFinalized=false;this.last=performance.now();
    this.onNotice('REVIVED · 4s SPAWN SHIELD');this.onUpdate(this.getStats());
    return true;
  }
  finalizeRun(){
    if(this.state!=='gameover'||!this.lastSummary||this.runFinalized||!this.save)return null;
    const summary=this.lastSummary;this.runFinalized=true;
    this.save.gamesPlayed++;this.save.totalFood+=this.foodEaten;this.save.totalKills+=this.kills;this.save.totalScore+=this.totalScore;
    this.save.coins+=this.coinsEarned+Math.floor(this.totalScore/180);this.save.xp+=Math.floor(this.totalScore/5)+Math.floor(this.elapsed);
    this.save.bestScore=Math.max(this.save.bestScore,this.totalScore);this.save.longestWorm=Math.max(this.save.longestWorm,summary.length);this.save.bestTime=Math.max(this.save.bestTime,this.elapsed);
    return summary;
  }
  render(now){
    if(!this.ctx)return;const ctx=this.ctx,w=this.cssWidth,h=this.cssHeight;
    const dpr=this.dpr||1;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const camera=this.player?this.camera:{x:WORLD.width/2,y:WORLD.height/2};
    const zoom=this.isPowerActive('zoom')?Math.max(.65,this.viewZoom*.84):this.viewZoom;
    const halfW = w / (2 * zoom);
    const halfH = h / (2 * zoom);
    const viewBounds = {
      minX: camera.x - halfW - 60,
      maxX: camera.x + halfW + 60,
      minY: camera.y - halfH - 60,
      maxY: camera.y + halfH + 60
    };

    ctx.save();
    ctx.translate(w/2-camera.x*zoom,h/2-camera.y*zoom);
    ctx.scale(zoom,zoom);
    this.drawArena(ctx, viewBounds);

    const foodStyle=this.save?.workshop?.foodStyle||'classic';
    for(let i=0;i<this.food.length;i++){
      const f=this.food[i];
      if(f.x<viewBounds.minX||f.x>viewBounds.maxX||f.y<viewBounds.minY||f.y>viewBounds.maxY)continue;
      const sprite=getFoodSprite(f.type,f.r,foodStyle);
      const pulse=1+Math.sin(now*.003+f.phase)*.07;
      const drawW=sprite.half*2*pulse;
      ctx.drawImage(sprite.canvas, f.x-drawW*0.5, f.y-drawW*0.5, drawW, drawW);
    }

    for(let i=0;i<this.coins.length;i++){
      const c=this.coins[i];
      if(c.x<viewBounds.minX||c.x>viewBounds.maxX||c.y<viewBounds.minY||c.y>viewBounds.maxY)continue;
      ctx.beginPath();ctx.arc(c.x,c.y,9,0,Math.PI*2);ctx.fillStyle='#ffcf42';ctx.fill();ctx.strokeStyle='#fff2a6';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#946117';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText('$',c.x,c.y+4);
    }

    for(let i=0;i<this.powerItems.length;i++){
      const item=this.powerItems[i];
      if(item.x<viewBounds.minX||item.x>viewBounds.maxX||item.y<viewBounds.minY||item.y>viewBounds.maxY)continue;
      const bob=Math.sin(now*.004+item.phase)*5;
      ctx.beginPath();ctx.arc(item.x,item.y+bob,item.r+3,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.86)';ctx.fill();
      ctx.beginPath();ctx.arc(item.x,item.y+bob,item.r,0,Math.PI*2);ctx.fillStyle=item.type.color;ctx.fill();
      ctx.font='20px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(displayText(item.type.icon),item.x,item.y+bob+1);
    }

    for(let i=0;i<this.bots.length;i++){
      const bot=this.bots[i];
      if(bot.alive){
        drawWorm(ctx,bot,bot.skin,now,zoom,viewBounds);
        this.drawSpawnShield(ctx,bot,now);
      }
    }

    if(this.player){
      drawWorm(ctx,this.player,this.player.skin,now,zoom,viewBounds);
      this.drawSpawnShield(ctx,this.player,now);
      ctx.font='17px system-ui';ctx.textAlign='center';ctx.fillText(this.save?.workshop?.emoji||'🐛',this.player.x+29,this.player.y-24);
    }

    if(this.save?.workshop?.particles!==false && this.particles.length){
      for(let i=0;i<this.particles.length;i++){
        const p=this.particles[i];
        if(p.x<viewBounds.minX||p.x>viewBounds.maxX||p.y<viewBounds.minY||p.y>viewBounds.maxY)continue;
        ctx.globalAlpha=clamp(p.life/p.max,0,1);
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();
      }
      ctx.globalAlpha=1;
    }

    if(this.mode==='battle'){
      ctx.beginPath();ctx.arc(WORLD.width/2,WORLD.height/2,this.arenaRadius,0,Math.PI*2);ctx.strokeStyle='rgba(255,70,70,.8)';ctx.lineWidth=5;ctx.setLineDash([16,12]);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
    if(this.state==='menu')this.drawIdle(ctx,w,h,now);
    if(this.state==='paused'){ctx.fillStyle='rgba(15,29,37,.48)';ctx.fillRect(0,0,w,h);}
  }
  drawArena(ctx, viewBounds){
    const theme=this.currentTheme||THEMES[0];
    const minX = Math.max(0, viewBounds.minX);
    const minY = Math.max(0, viewBounds.minY);
    const maxX = Math.min(WORLD.width, viewBounds.maxX);
    const maxY = Math.min(WORLD.height, viewBounds.maxY);

    ctx.fillStyle=theme.bg;
    ctx.fillRect(minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY));

    ctx.strokeStyle=theme.grid;
    ctx.lineWidth=1;
    ctx.globalAlpha=.35;
    ctx.beginPath();
    const startX = Math.floor(minX / 90) * 90;
    for(let x=startX; x<=maxX; x+=90){
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    const startY = Math.floor(minY / 90) * 90;
    for(let y=startY; y<=maxY; y+=90){
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
    ctx.globalAlpha=1;

    for(let i=0;i<150;i++){
      const x=(i*197+73)%WORLD.width, y=(i*313+119)%WORLD.height;
      if(x<minX||x>maxX||y<minY||y>maxY)continue;
      ctx.fillStyle=i%3===0?'rgba(255,255,255,.22)':'rgba(44,110,50,.17)';
      ctx.beginPath();ctx.arc(x,y,i%5===0?4:2,0,Math.PI*2);ctx.fill();
    }

    ctx.strokeStyle='#ffe84a';ctx.lineWidth=42;ctx.strokeRect(24,24,WORLD.width-48,WORLD.height-48);
    ctx.strokeStyle='rgba(13,71,43,.98)';ctx.lineWidth=7;ctx.strokeRect(48,48,WORLD.width-96,WORLD.height-96);
    ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=3;ctx.strokeRect(54,54,WORLD.width-108,WORLD.height-108);
  }
  drawIdle(ctx,w,h,now){
    ctx.save();ctx.translate(w/2,h/2);ctx.fillStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.arc(0,0,Math.min(w,h)*.29,0,Math.PI*2);ctx.fill();
    const t=now*.0004;for(let i=0;i<8;i++){const a=t+i*Math.PI/4,x=Math.cos(a)*Math.min(w,h)*.18,y=Math.sin(a)*Math.min(w,h)*.18;ctx.beginPath();ctx.arc(x,y,12+Math.sin(t*4+i)*3,0,Math.PI*2);ctx.fillStyle=['#ff9b50','#72d9a0','#73c8ff','#f3db54'][i%4];ctx.fill();}
    ctx.restore();
  }
}
