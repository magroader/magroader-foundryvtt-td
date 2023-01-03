const GRID_SIZE = 100;

export class WaveTick {
  constructor() {
    this._initSucess = false;
    this._entrance = null;
    this._entranceGridPos = null;
    this._exit = null;
    this._exitGridPos = null;
    this._enabledTokens = null;
    this._fullPath = null;
    this._pathHashToPathIndex = null;
  }

  async performTick() {
    await this.init();
    if (!this._initSuccess)
      return;

    await this.performHostileMove();
    await this.performFriendlyAttack();
  }

  async init() {
    let tokenLayer = canvas.tokens;
    let placeables = Array.from(tokenLayer.placeables);

    this._exit = this.getTokenWithName("Exit", placeables);
    if (this._exit == null)
      return;
    this._exitGridPos = this.getTokenGridPos(this._exit);

    this._entrance = this.getTokenWithName("Entrance", placeables);
    if (this._entrance == null)
      return;
    this._entranceGridPos = this.getTokenGridPos(this._entrance);
    
    this._enabledTokens = placeables
      .filter(t => !t.document.hidden);
    
    this._fullPath = await routinglib.calculatePath(this.gridPosToPathPos(this._entranceGridPos), this.gridPosToPathPos(this._exitGridPos), {interpolate:false});
    if (this._fullPath == null)
      return;
    
    this._pathHashToPathIndex = {};
    for (let i = 0 ; i < this._fullPath.path.length ; ++i) {
      let p = this._fullPath.path[i]
      let key = this.hashPathPos(p);
      this._pathHashToPathIndex[key] = i;
    }

    this._initSuccess = true;
  }

  async performHostileMove() {
    let hostilePlan = await this.calculateHostilesPlan();

    let hostileMoveProm = [];
    for(let hp of hostilePlan) {
      let p = this.moveTokenAlongPath(hp.token, hp.path.path, {maxSteps:4});
        if (p) {
          hostileMoveProm.push(p);
          await this.sleep(150);
        }
    }

    await Promise.all(hostileMoveProm);
  }

  async performFriendlyAttack() {

    let hostilePlan = await this.calculateHostilesPlan();
    if (hostilePlan.length <= 0)
      return;

    let activeHostileTokens = hostilePlan.map(p => p.token);
    let hostileHpMap = this.getTokenHpMap(activeHostileTokens);

    let friendlyTokens = this._enabledTokens
      .filter(t => t.document.disposition == 1);

    let entrancePos = {x:this._entrance.document.x, y:this._entrance.document.y};
    friendlyTokens.sort((a, b) => {
      let sqDistanceA = this.distanceSq(a.document, entrancePos);
      let sqDistanceB = this.distanceSq(b.document, entrancePos);
      return sqDistanceA-sqDistanceB;
    });

    let friendlyAttackProm = [];

    for (let t of this.getTokensWithName(friendlyTokens, "Bugbear")) {
      await this.appendFriendlyAttack(friendlyAttackProm, this.getBugbearAttack(t, activeHostileTokens, hostileHpMap));
    }
    for (let t of this.getTokensWithName(friendlyTokens, "Goblin Archer")) {
      await this.appendFriendlyAttack(friendlyAttackProm, this.getGoblinArcherAttack(t, activeHostileTokens, hostileHpMap));
    }

    // Need to do this all in a batch per token, because attempting to call applyDamage multiple
    // times in a row without awaiting only applies 1 of them :-(  Could make a queue, but that's
    // too much darn work.
    for (let h of activeHostileTokens) {
      let curHp = h.document.actor.system.attributes.hp.value;
      let newHp = hostileHpMap[h.document.id];
      let damage = curHp - newHp;
      if (damage > 0) {
        friendlyAttackProm.push(h.document.actor.applyDamage(damage));
      }
    }

    await Promise.all(friendlyAttackProm);
  }

  async appendFriendlyAttack(promList, prom) {
    if (prom) {
      promList.push(prom);
      await this.sleep(400);
    }
  }

  getBugbearAttack(token, hostileTokens, hostileHpMap) {
    return this.performRangedAttack(token, 1, 5, "jb2a.greatclub.standard", hostileTokens, hostileHpMap);
  }

  getGoblinArcherAttack(token, hostileTokens, hostileHpMap) {
    return this.performRangedAttack(token, 3, 3, "jb2a.arrow.physical.white", hostileTokens, hostileHpMap);
  }

  performRangedAttack(token, spaces, damage, anim, hostileTokens, hostileHpMap) {
    let nearest = this.getFirstTokenWithinSpacesWithHp(token, spaces, hostileTokens, hostileHpMap);
    if (nearest == null)
      return null;

    hostileHpMap[nearest.document.id] = hostileHpMap[nearest.document.id] - damage;

    return this.performAttackAnim(token, nearest, anim);
  }

  async performAttackAnim(source, target, anim) {
    let s = new Sequence();
    s.effect()
      .atLocation(source.document)
      .stretchTo(target.document)
      .file(anim)
      .waitUntilFinished();
    await s.play();
  }

  getTokensWithName(tokens, name) {
    return tokens.filter(t => t.document.name == name);
  }

  getTokenHpMap(tokens) {
    let map = {};
    for (let t of tokens) {
      map[t.document.id] = t.document.actor.system.attributes.hp.value;
    }
    return map;
  }

  getFirstTokenWithinSpacesWithHp(sourceToken, spaces, orderedTargets, targetHp) {
    for (let t of orderedTargets) {
      if (targetHp[t.document.id] <= 0)
        continue;

      if (this.isWithinSpaces(sourceToken.document, t.document, spaces)) {
        return t;
      }
    }
    return null;
  }

  distanceSq(a, b) {
    let xD = b.x - a.x;
    let yD = b.y - a.y;
    return xD*xD + yD*yD;
  }

  getTokenWithName(name, placeables) {
    let tokens = placeables
      .filter(t => t.document.name == name);
    if (tokens.length != 1) {
      throw new Error("Expected a single token named '" + name + "', found " + tokens.length);
    }
    return tokens[0];
  }

  isWithinSpaces(source, target, gridSquares) {
    let sqDist = this.distanceSq(source, target);
    let desiredDist = (gridSquares * GRID_SIZE)*(gridSquares * GRID_SIZE) + GRID_SIZE; // adding extra for rounding
    return sqDist <= desiredDist;
  }

  async calculateHostilesPlan() {
    let hostileTokens = this._enabledTokens
      .filter(t => t.document.disposition == -1)
      .filter(t => t.actor.system.attributes.hp.value > 0);

    if (hostileTokens.length <= 0)
      return [];

    let hostilePlan = [];
    for (let t of hostileTokens) {
      let plan = await this.getTokenPlannedPath(t, this._exitGridPos);
      if (plan)
        hostilePlan.push(plan);
    }
      
    hostilePlan.sort((a, b) => {
      if (a.path.cost == b.path.cost) {
        return b.system.attributes.hp.value - a.system.attributes.hp.value;
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

  async moveTokenAlongPath(token, path, options) {
    const td = token.document;
    let grid = canvas.grid.grid;

    let maxSteps = options.maxSteps || path.Length-1;
    if (maxSteps > path.length-1)
      maxSteps = path.length-1;
    for (let i = 1 ; i <= maxSteps ; ++i) {
      let p = path[i];
      let newPos = grid.getPixelsFromGridPosition(p.y, p.x);
      await td.update({
        x:newPos[0],
        y:newPos[1]
      });
      await this.sleep(400);
    }
  }

  gridPosToPathPos(gridPos) {
    return {x:gridPos[1], y:gridPos[0]};
  }

  hashPathPos(pathPos) {
    return "x:" + pathPos.x + ",y:" + pathPos.y;
  }

  async getTokenPlannedPath(token, endGridPos) {
    const td = token.document;
    const grid = canvas.grid.grid;
    const tdGridPos = grid.getGridPositionFromPixels(td.x, td.y);
    const tdPathPos = this.gridPosToPathPos(tdGridPos);
    const tdPathHash = this.hashPathPos(tdPathPos);

    const pathIndex = this._pathHashToPathIndex[tdPathHash];

    let path = null;
    if (pathIndex == null) {
      path = await routinglib.calculatePath(this.gridPosToPathPos(tdGridPos), this.gridPosToPathPos(endGridPos), {interpolate:false});
    } else {
      // This token is on the happy path from entrance to exit, do not need to calc again
      const slicedPath = this._fullPath.path.slice(pathIndex);
      path = {
        cost: this._fullPath.cost - pathIndex, // Assumed: cost 1 for each movement
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