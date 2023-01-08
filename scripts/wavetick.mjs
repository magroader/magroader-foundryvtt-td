const DO_HOSTILE_MOVE = false;
const DO_FRIENDLY_ATTACKS = true;
const DO_DEAL_DAMAGE = true;
const DELETE_DEAD_HOSTILES = true;

const MAX_MOVE_DELAY = 1000;
const MAXIMUM_ATTACK_TIME = 2000;

export class WaveTick {
  constructor() {

    this._orderedAttackFunctions = [
      ["Bennikkt", this, this.getBennikktBuff],
      ["Dagor", this, this.getDagorAttack],
      ["Thug", this, this.getThugAttack],
      ["Guard", this, this.getGuardAttack],
      ["Bugbear", this, this.getBugbearAttack],
      ["Kethis", this, this.getKethisAttack],
      ["Goblin", this, this.getGoblinAttack],
      ["Bartok", this, this.getBartokAttack],
    ];

    this._initSucess = false;
    this._entrance = null;
    this._entranceGridPos = null;
    this._exit = null;
    this._exitGridPos = null;
    this._enabledTokens = null;
    this._friendlyTokens = null;
    this._fullPath = null;
    this._gridPosToPathIndexMap = null;
    this._gridPosToHostileTokensMap = null;
    this._gridPosToFriendlyTokensMap = null;
    this._friendlyWallIds = null;
    this._tokenInfoMap = null;
  }

  async performTick() {
    await this.init();
    if (!this._initSuccess)
      return;

    await this.createFriendlyWalls();
    const pathSuccess = await this.calculateHappyPath();

    let err = null;
    try {
      if (pathSuccess) {
        if (DO_HOSTILE_MOVE)
          await this.performHostileMove();
        if (DO_FRIENDLY_ATTACKS)
          await this.performFriendlyAttack();
      }      
    } catch (error) {
      err = error;
    }

    await this.destroyFriendlyWalls();

    if (!pathSuccess)
      throw new Error ("Unable to create a path from the entrance to the exit");
    if (err != null)
      throw err;

    const hostilePlan = await this.calculateHostilesPlan();
    if (hostilePlan.length > 0)
      return true;

    if (DELETE_DEAD_HOSTILES)
      await this.deleteDeadHostiles();
    return false;
  }

  async init() {
    const tokenLayer = canvas.tokens;
    const placeables = Array.from(tokenLayer.placeables);

    this._exit = this.getTokenWithName("Exit", placeables);
    if (this._exit == null)
      return;
    this._exitGridPos = this.getTokenGridPos(this._exit);

    this._entrance = this.getTokenWithName("Entrance", placeables);
    if (this._entrance == null)
      return;
    this._entranceGridPos = this.getTokenGridPos(this._entrance);
      
    this._tokenInfoMap = {};
    
    this._enabledTokens = placeables
      .filter(t => !t.document.hidden);

    this.setupFriendlyTokens();

    this._initSuccess = true;
  }

  async calculateHappyPath() {
    this._fullPath = await routinglib.calculatePath(this.pathPosFromGridPos(this._entranceGridPos), this.pathPosFromGridPos(this._exitGridPos), {interpolate:false});
    if (this._fullPath == null)
      return false;
    
    this._gridPosToPathIndexMap = {};
    for (let i = 0 ; i < this._fullPath.path.length ; ++i) {
      const pp = this._fullPath.path[i];
      const gp = this.gridPosFromPathPos(pp);
      this._gridPosToPathIndexMap[gp] = i;
    }
    return true;
  }

  async performHostileMove() {

    let hostilePlan = await this.calculateHostilesPlan();
    if (hostilePlan.length <= 0)
      return;

    this.setupHostileGridMap(hostilePlan);

    const moveDelay = Math.min(500, (MAX_MOVE_DELAY / hostilePlan.length));

    let hostileMoveProm = [];
    for(let hp of hostilePlan) {
      
      const moveSpeed = (hp.token.document.actor.system.attributes.movement.walk || 20) / 5; // assumed: 5 feet per grid space
      const thisMoveDelay = moveDelay / moveSpeed;
      const p = this.moveTokenAlongPath(hp.token, hp.path.path, {maxSteps:moveSpeed, sleep:thisMoveDelay});
      if (p) {
        hostileMoveProm.push(p);
        await this.sleep(thisMoveDelay);
      }
    }

    await Promise.all(hostileMoveProm);
  }

  async performFriendlyAttack() {
    let hostilePlan = await this.calculateHostilesPlan();
    if (hostilePlan.length <= 0)
      return;

    this.setupHostileGridMap(hostilePlan);

    let activeHostileTokens = hostilePlan.map(p => p.token);
    this.setupTokenHpInfo(activeHostileTokens);

    let tokenNameToTokens = {};
    for (let t of this._friendlyTokens
      .filter(t => t.document.actor.system.attributes.hp.value > 0)) {
      let tokensSharingName = tokenNameToTokens[t.document.name];
      if (tokensSharingName == null) {
        tokensSharingName = []
        tokenNameToTokens[t.document.name] = tokensSharingName;
      }
      tokensSharingName.push(t);
    }

    let friendlyAttackProms = [];
    
    for (let oa of this._orderedAttackFunctions) {
      const tokenName = oa[0];
      const context = oa[1];
      const attackFunc = oa[2];

      let allNamedTokens = tokenNameToTokens[tokenName];
      if (allNamedTokens == null)
        continue;

      for (let t of allNamedTokens) {
        let attackProm = attackFunc.call(context, t);
        if (attackProm != null) {
          await this.appendFriendlyAttack(friendlyAttackProms, attackProm);
        }
      }
    }

    await Promise.all(friendlyAttackProms);
  }

  async deleteDeadHostiles() {
    const deadHostiles = this.getDeadHostileTokens();
    const ids = deadHostiles.map(t => t.document.id);
    await canvas.scene.deleteEmbeddedDocuments("Token", ids);  
  }

  getTokenInfo(token) {
    let info = this._tokenInfoMap[token.document.id];
    if (info == null) {
      info = {token : token};
      this._tokenInfoMap[token.document.id] = info;
    }
    return info;
  }

  async createFriendlyWalls() {
    const grid = canvas.grid.grid;
    const gridBorderPoly = grid.getBorderPolygon(1, 1, 0);

    let wallsToCreate = [];
    for (let token of this._friendlyTokens) {
      const tl = grid.getTopLeft(token.document.x, token.document.y);

      let wallPoints = [];
      for (let i = 0 ; i < gridBorderPoly.length ; i += 2) {
        wallPoints.push(gridBorderPoly[i] + tl[0]);
        wallPoints.push(gridBorderPoly[i+1] + tl[1]);
      }
      wallPoints.push(gridBorderPoly[0] + tl[0]);
      wallPoints.push(gridBorderPoly[1] + tl[1]);

      for (let i = 2 ; i < wallPoints.length ; i += 2) {
        let wall = new WallDocument({
          c : [
            wallPoints[i-2],
            wallPoints[i-1],
            wallPoints[i],
            wallPoints[i+1],
          ],
          light: 0,
          sound: 0,
          sight: 0
        });

        wallsToCreate.push(wall);
      }
    }
  
    let createdWalls = await canvas.scene.createEmbeddedDocuments("Wall", wallsToCreate);
    this._friendlyWallIds = createdWalls.map(w => w.id);
  }

  async destroyFriendlyWalls() {
    await canvas.scene.deleteEmbeddedDocuments("Wall", this._friendlyWallIds);  
  }

  async appendFriendlyAttack(promList, prom) {
    if (prom) {
      promList.push(prom);
      const attackDelay = Math.min(250, MAXIMUM_ATTACK_TIME / this._friendlyTokens.length);
      await this.sleep(attackDelay);
    }
  }

  getFriendlyTokenBuffedDamage(token, baseDamage) {
    const info = this.getTokenInfo(token);
    if (!info.damageBuff)
      return baseDamage;
    const finalDamage = baseDamage + Math.min(5, baseDamage);
    return finalDamage;
  }

  getThugAttack(token) {
    const damage = this.getFriendlyTokenBuffedDamage(token, 12);
    return this.performRangedAttacks(token, 1, damage, "jb2a.mace.melee.01.white");
  }

  getGoblinAttack(token) {
    const damage = this.getFriendlyTokenBuffedDamage(token, 2);
    return this.performRangedAttacks(token, 3, damage, "jb2a.arrow.physical.white.01", {numAttacks:2, onePerCell:true});
  }

  getGuardAttack(token) {
    const damage = this.getFriendlyTokenBuffedDamage(token, 8);
    return this.performRangedAttacks(token, 5, damage, this.hasJb2aPatreon() ? "jb2a.bolt.physical.white" : "jb2a.bolt.physical", {minRange: 4});
  }

  getBugbearAttack(token) {
    const range = 3;
    const damage = this.getFriendlyTokenBuffedDamage(token, 5);

    const sourceGridPos = this.getTokenGridPos(token);
    const reachableCells = this.getCellsWithinRange(sourceGridPos, range, {minRange:2});

    if (reachableCells.length <= 0)
      return null;

    const reachable = reachableCells.map((cell) =>
    {
      const blast = this.getHostileInfosInRangeSortedByHp(cell, 1, {includeStartPos:true});
      const totalHp = blast.reduce((sum, info) => sum + Math.min(Math.max(0, info.hp), damage), 0);
      const totalCost = blast.reduce((sum, info) => sum + info.path.cost, 0);
      return {
        cell : cell,
        blast : blast,
        totalHp : totalHp,
        totalCost : totalCost
      };
    }).filter(o => o.totalHp > 0);

    if (reachable.length <= 0)
      return null;

    reachable.sort((a,b) => {
      if (a.totalHp == b.totalHp)
        return a.totalCost - b.totalCost;
      return b.totalHp - a.totalHp;
    });

    const target = reachable[0];
    return this.performBugbearAttackAnim(token, target.cell, damage, target.blast);
  }

  getBartokAttack(token) {
    const damage = this.getFriendlyTokenBuffedDamage(token, 15);
    return this.performRangedAttacks(token, 1, damage, this.hasJb2aPatreon() ? "jb2a.greataxe.melee.fire.blue" : "jb2a.greataxe.melee.standard.white", {numAttacks:2, onePerCell:true, pushback:2, attackDelay:1650});
  }
  
  getBennikktBuff(token) {
    const range = 2;
    const gridPos = this.getTokenGridPos(token);
    const tokensToBuff = this.getFriendlyTokensWithinRange(gridPos, range, {ignoreSight: true});

    for(let t of tokensToBuff) {
      const info = this.getTokenInfo(t);
      info.damageBuff = true;
    }

    return this.performBennikktBuffAnim(token, range);
  }
  
  getDagorAttack(token) {
    const range = 6;
    const damage = this.getFriendlyTokenBuffedDamage(token, 25);

    const sourceGridPos = this.getTokenGridPos(token);
    const infos = this.getHostileInfosInRangeSortedByHp(sourceGridPos, range, {sortByHpFirst : true});
    if (infos.length <= 0)
      return;

    return this.performDagorAttackAnim(token, infos[0], damage);
  }
  
  getKethisAttack(token) {
    const eldritchRange = 9;
    const meleeDamage = this.getFriendlyTokenBuffedDamage(token, 20);
    const rangedDamage = this.getFriendlyTokenBuffedDamage(token, 12);

    const sourceGridPos = this.getTokenGridPos(token);
    const meleeHostiles = this.getHostileTokensWithinRange(sourceGridPos, 1);
    const rangeHostiles = this.getHostileTokensWithinRange(sourceGridPos, eldritchRange, {onePerCell:true, minRange:2});

    if (meleeHostiles.length >= 2 || (rangeHostiles.length < 2 && meleeHostiles.length > 0))
      return this.performRangedAttacks(token, 1, meleeDamage, this.hasJb2aPatreon() ? "jb2a.greatsword.melee.fire.black" : "jb2a.greatsword.melee.standard.white", {numAttacks:2, onePerCell:true, attackDelay:1250});
    return this.performRangedAttacks(token, eldritchRange, rangedDamage, "jb2a.eldritch_blast.purple", {numAttacks:2, onePerCell:true, attackDelay:1100, minRange:2}); 
  }

  async performBennikktBuffAnim(sourceToken, range) {
    const size = range*2+1.5;
    const s = new Sequence();
    s.effect()
      .atLocation(sourceToken.document)
      .file("jb2a.bless.400px.intro.blue")
      .size({width:size, height:size}, {gridUnits:true})
      .timeRange(1250, 2500)
      .fadeOut(500)
      .opacity(0.5)
      ;
    await s.play(); 
  }

  async performDagorAttackAnim(sourceToken, targetInfo, damage) {
    const targetToken = targetInfo.token;
    const sourceLocation = {x:sourceToken.document.x, y:sourceToken.document.y};
    const self = this;

    targetInfo.hp = targetInfo.hp - damage;

    const s = new Sequence();
    s.animation()
      .on(sourceToken)
      .moveTowards(targetToken, {ease:"easeInOutSine"})
      .moveSpeed(20)
      .closestSquare(true)
      .waitUntilFinished();
  
    this.addDamageEffectToSequence(s, sourceToken, targetToken, "jb2a.rapier.melee.01.white")
      .startTime(1000)
      .endTime(500)
      .fadeIn(100)
      .fadeOut(500)
      .waitUntilFinished(-750);

    this.addDamageApplyToSequence(s, targetToken, damage);

    s.animation()
      .on(sourceToken)
      .moveTowards(sourceLocation, {ease:"easeInOutSine"})
      .moveSpeed(20)
      .waitUntilFinished();
    await s.play();
  }

  async performBugbearAttackAnim(sourceToken, targetCell, damage, hostileInfos) {
    
    const grid = canvas.grid.grid;
    const targetPixels = grid.getPixelsFromGridPosition(targetCell[0], targetCell[1]);
    const targetCenter = grid.getCenter(targetPixels[0], targetPixels[1]);
    const targetPosObj = {x:targetCenter[0], y:targetCenter[1]};

    const self = this;
    
    for(const hi of hostileInfos) {
      hi.hp = hi.hp - damage;
    }

    const anim = this.hasJb2aPatreon() ? "jb2a.boulder.toss" : "jb2a.explosion";
    const s = new Sequence();
    s.effect()
      .atLocation(sourceToken.document, {offset: {x:0.25}, local:true, gridUnits:true})
      .stretchTo(targetPosObj, {randomOffset:0.2})
      .file(anim)
      .waitUntilFinished(-1500);
    s.thenDo(async function() {
      const damageProms = hostileInfos.map((hi) => self.applyDamage(hi.token, damage));  
      await Promise.all(damageProms);      
    });
    await s.play();
  }

  hasJb2aPatreon() {
    return game.modules.get('jb2a_patreon')?.active;
  }

  performRangedAttacks(sourceToken, range, damage, animName, options={}) {
    const sourceGridPos = this.getTokenGridPos(sourceToken);
    const infos = this.getHostileInfosInRangeSortedByHp(sourceGridPos, range, options);
    if (infos.length == 0)
      return null;
    
    const numAttacks = options.numAttacks || 1;
    return this.performRangedAttacksOnInfos(sourceToken, infos, numAttacks, damage, animName, options);
  }

  async performRangedAttacksOnInfos(sourceToken, infos, numAttacks, damage, animName, options={}) {

    const self = this;
    const pushback = options.pushback || 0;
    const attackDelay = options.attackDelay || 250;    

    const attackPromises = [];

    for(let i = 0 ; i < numAttacks && i < infos.length ; ++i) {
      const thisInfo = infos[i];
      thisInfo.hp = thisInfo.hp - damage;
      const attackAnim = this.performAttackAnim(sourceToken, thisInfo.token, animName, damage);
      if (attackAnim) {
        attackPromises.push(attackAnim);

        if (pushback > 0) {
          attackAnim.then(async function() {await self.performPushbackAnim(thisInfo, pushback);});
        }

        if (i+1 < infos.length && i+i < numAttacks) {
          await this.sleep(attackDelay);
        }
      }
    }

    await Promise.all(attackPromises);
  }


  getHostileInfosInRangeSortedByHp(sourceGridPos, range, options={}) {
    const inRange = this.getHostileTokensWithinRange(sourceGridPos, range, options);
    const infos = inRange.map(t => this.getTokenInfo(t));
    const sortByHpFirst = options.sortByHpFirst || false;
    
    infos.sort((a, b) => {
      if (a.token && b.token && a.path && b.path) {
        if (sortByHpFirst) {
          if (b.token.actor.system.attributes.hp.value == a.token.actor.system.attributes.hp.value)
            return a.path.cost - b.path.cost;
          return b.token.actor.system.attributes.hp.value - a.token.actor.system.attributes.hp.value;
        } else {
          if (a.path.cost == b.path.cost)
            return b.token.actor.system.attributes.hp.value - a.token.actor.system.attributes.hp.value;
          return a.path.cost - b.path.cost;
        }
      }
      return -1;
    });
    return infos;
  }

  getFriendlyTokensWithinRange(gridPos, range, options={}) {
    return this.getTokensWithinRange(this._gridPosToFriendlyTokensMap, gridPos, range, options);
  }

  getHostileTokensWithinRange(gridPos, range, options={}) {
    return this.getTokensWithinRange(this._gridPosToHostileTokensMap, gridPos, range, options);
  }
  
  getTokensWithinRange(gridPosToTokenMap, gridPos, range, options={}) {
    const reachableCells = this.getCellsWithinRange(gridPos, range, options);

    const onePerCell = options.onePerCell || false;

    let ret = [];
    for(const cell of reachableCells) {
      const inCell = gridPosToTokenMap[cell];
      if (inCell && inCell.length > 0) {
        if (onePerCell) {
          inCell.sort((a,b) => {
            return b.actor.system.attributes.hp.value - a.actor.system.attributes.hp.value;
          });
          ret.push(inCell[0]);
        } else {
          ret = ret.concat(inCell);
        }
      }
    }

    return ret;
  }

  getCellsWithinRange(startGridPos, range, options={}) {
    const grid = canvas.grid.grid;

    options = options || {};
    const includeStartPos = options.includeStartPos || false;
    const minRange = options.minRange || 0;
    const ignoreSight = options.ignoreSight || false;

    const queue = [[startGridPos, 0]];

    const visited = {};
    visited[startGridPos] = true;
    const result = [];
    if (includeStartPos) {
      result.push(startGridPos);
    }

    const startGridPixels = grid.getPixelsFromGridPosition(startGridPos[0], startGridPos[1]);
    const startGridPoint = {x:startGridPixels[0], y:startGridPixels[1]};

    while (queue.length > 0) {
      const cur = queue.shift();
      const gridPos = cur[0];
      const spaces = cur[1];

      if (spaces < range) {
        const neighbors = grid.getNeighbors(gridPos[0], gridPos[1]);

        for (const n of neighbors) {
          if (visited[n])
            continue;
          visited[n] = true;

          const nPixels = grid.getPixelsFromGridPosition(n[0], n[1]);
          const nPoint = {x:nPixels[0], y:nPixels[1]};

          if (!ignoreSight) {
            const hitsWall = canvas.walls.checkCollision(new Ray(startGridPoint, nPoint), {type:"sight",mode:"any"});
            if (hitsWall) {
              continue;
            }
          }

          if (spaces+1 >= minRange)
            result.push(n);
          queue.push([n, spaces+1]);
        }
      }
    }

    return result;
  }

  async performAttackAnim(source, target, anim, damage) {
    const s = new Sequence();
    this.addAttackAndDamageToSequence(s, source, target, anim, damage)
    await s.play();
  }

  addAttackAndDamageToSequence(sequence, source, target, anim, damage) {
    this.addDamageEffectToSequence(sequence, source, target, anim);
    return this.addDamageApplyToSequence(sequence, target, damage);
  }

  addDamageEffectToSequence(sequence, source, target, anim) {
    return sequence.effect()
      .atLocation(source.document, {offset: {x:0.25}, local:true, gridUnits:true})
      .stretchTo(target.document, {randomOffset: 0.1})
      .file(anim)
      .waitUntilFinished(-500);
  }

  addDamageApplyToSequence(sequence, target, damage) {
    const self = this;
    return sequence.thenDo(async function() {
      await self.applyDamage(target, damage);  
    });
  }

  async performPushbackAnim(hostileInfo, pushback) {

    const grid = canvas.grid.grid;
    const enemyGridPos = grid.getGridPositionFromPixels(hostileInfo.token.document.x, hostileInfo.token.document.y);
    const pathToEntrance = await routinglib.calculatePath(this.pathPosFromGridPos(enemyGridPos), this.pathPosFromGridPos(this._entranceGridPos), {interpolate:false});
    if (pathToEntrance == null || pathToEntrance.path.length < 3)
      return;

    const pushToPathPos = pathToEntrance.path[2];
    const pushToGridPos = this.gridPosFromPathPos(pushToPathPos);
    const pushToPixels = grid.getPixelsFromGridPosition(pushToGridPos[0], pushToGridPos[1]);

    // NOTE: Assumed that this is the last thing that happens, so we don't go recalculating all the paths and such
    const s = new Sequence()
      .animation()
        .on(hostileInfo.token)
        .moveTowards({x:pushToPixels[0], y:pushToPixels[1]}, {ease: "easeOutExpo"})
    await s.play()
  }

  applyDamage(target, damage) {
    if (!DO_DEAL_DAMAGE)
      return Promise.resolve();

    const info = this.getTokenInfo(target);
     
    if (info.updatePromise == null)
      info.updatePromise = target.document.actor.applyDamage(damage);
    else 
      info.updatePromise = info.updatePromise.then(() => {target.document.actor.applyDamage(damage)});

    return info.updatePromise;
  }

  setupHostileGridMap(hostilePlan) {
    this._gridPosToHostileTokensMap = {};
    for (let hp of hostilePlan) {
      if (hp.path.path.length > 0) {
        const start = this.gridPosFromPathPos(hp.path.path[0]);
        let arr = this._gridPosToHostileTokensMap[start];
        if (arr == null) {
          arr = [];
          this._gridPosToHostileTokensMap[start] = arr;
        }
        arr.push(hp.token);
      }
    }
  }

  setupFriendlyTokens() {      
    this._friendlyTokens = this._enabledTokens
      .filter(t => t.document.disposition == 1 && 
        t.document.actor.system.attributes.hp.value > 0);

    const entrancePos = {x:this._entrance.document.x, y:this._entrance.document.y};
    this._friendlyTokens.sort((a, b) => {
      const sqDistanceA = this.distanceSq(a.document, entrancePos);
      const sqDistanceB = this.distanceSq(b.document, entrancePos);
      return sqDistanceA-sqDistanceB;
    });

    this._gridPosToFriendlyTokensMap = {};
    for (let t of this._friendlyTokens) {
      const gridPos = this.getTokenGridPos(t);
      let arr = this._gridPosToFriendlyTokensMap[gridPos];
      if (arr == null) {
        arr = [];
        this._gridPosToFriendlyTokensMap[gridPos] = arr;
      }
      arr.push(t);
    }
  }

  setupTokenHpInfo(tokens) {
    for (let t of tokens) {
      let info = this.getTokenInfo(t);
      info.hp = t.document.actor.system.attributes.hp.value;
    }
  }

  distanceSq(a, b) {
    let xD = b.x - a.x;
    let yD = b.y - a.y;
    return xD*xD + yD*yD;
  }

  getTokenWithName(name, placeables) {
    const tokens = placeables
      .filter(t => t.document.name == name);
    if (tokens.length != 1) {
      throw new Error("Expected a single token named '" + name + "', found " + tokens.length);
    }
    return tokens[0];
  }

  getHostileTokens() {
    return this._enabledTokens
      .filter(t => t.document.disposition == -1);
  }

  getDeadHostileTokens() {
    return this.getHostileTokens()
      .filter(t => t.actor.system.attributes.hp.value <= 0);
  }

  getEnabledHostileTokens() {
    return this.getHostileTokens()
      .filter(t => t.actor.system.attributes.hp.value > 0);
  }

  async calculateHostilesPlan() {
    let hostileTokens = this.getEnabledHostileTokens();

    if (hostileTokens.length <= 0)
      return [];

    let hostilePlan = [];
    for (let t of hostileTokens) {
      const plan = await this.getTokenPlannedPath(t, this._exitGridPos);
      if (plan) {
        hostilePlan.push(plan);
        const info = this.getTokenInfo(t);
        info.path = plan.path;
      }
    }

    hostilePlan.sort((a, b) => {
      if (a.path.cost == b.path.cost) {
        return b.token.actor.system.attributes.hp.value - a.token.actor.system.attributes.hp.value;
      }
      return a.path.cost - b.path.cost;
    });
    hostilePlan = hostilePlan.filter(p => p.path.cost > 0);

    return hostilePlan;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getTokenGridPos(token) {
    const td = token.document;
    const grid = canvas.grid.grid;
    const tdPos = grid.getGridPositionFromPixels(td.x, td.y);
    return tdPos;
  }

  async moveTokenAlongPath(token, path, options={}) {
    const td = token.document;
    const grid = canvas.grid.grid;

    const maxSteps = Math.min(options.maxSteps || path.Length-1, path.length-1);

    const stepDuration = 800/options.maxSteps;
    for (let i = 1 ; i <= maxSteps ; ++i) {
      const p = path[i];
      const newPos = grid.getPixelsFromGridPosition(p.y, p.x);
      const nPoint = {x:newPos[0], y:newPos[1]};

      const upP = td.update(nPoint, {animation:{duration:stepDuration}});
      const slP = this.sleep(stepDuration);
      await Promise.all([upP, slP]);
    }
  }

  pathPosFromGridPos(gridPos) {
    return {x:gridPos[1], y:gridPos[0]}
  }

  gridPosFromPathPos(pathPos) {
    return [pathPos.y, pathPos.x];
  }

  async getTokenPlannedPath(token, endGridPos) {
    const td = token.document;
    const grid = canvas.grid.grid;
    const tdGridPos = grid.getGridPositionFromPixels(td.x, td.y);
    const pathIndex = this._gridPosToPathIndexMap[tdGridPos];

    let path = null;
    if (pathIndex == null) {
      path = await routinglib.calculatePath(this.pathPosFromGridPos(tdGridPos), this.pathPosFromGridPos(endGridPos), {interpolate:false});
    } else {
      // This token is on the happy path from entrance to exit, do not need to calc again
      const slicedPath = this._fullPath.path.slice(pathIndex);
      path = {
        cost: this._fullPath.cost - (pathIndex*5), // Assumed: cost 5 for each movement
        path: slicedPath
      };
    }

    if (path == null)
      return null;

    return {
      token: token,
      path: path
    }
  }
}