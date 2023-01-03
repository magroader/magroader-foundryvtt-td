const GRID_SIZE = 100;

export class WaveTick {
  constructor() {

  }

  async performTick() {
    await this.performHostileMove();
    await this.performFriendlyAttack();
  }

  async performHostileMove() {

    let tokenLayer = canvas.tokens;
    let placeables = Array.from(tokenLayer.placeables);

    let exitToken = this.getTokenWithName("Exit", placeables);
    if (exitToken == null)
      return;
    
    let enabledTokens = placeables
      .filter(t => !t.document.hidden);

    let hostileTokens = enabledTokens
      .filter(t => t.document.disposition == -1)
      .filter(t => t.actor.system.attributes.hp.value > 0);

    if (hostileTokens.length <= 0)
      return;

    let exitTokenGridPos = this.getTokenGridPos(exitToken);

    let hostilePlan = await this.getHostilesPlan(hostileTokens, exitTokenGridPos);
    if (hostilePlan.length <= 0)
      return;

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
    let tokenLayer = canvas.tokens;
    let placeables = Array.from(tokenLayer.placeables);

    let exitToken = this.getTokenWithName("Exit", placeables);
    if (exitToken == null)
      return;

    let entranceToken = this.getTokenWithName("Entrance", placeables);
    if (entranceToken == null)
      return;
    
    let enabledTokens = placeables
      .filter(t => !t.document.hidden);

    let hostileTokens = enabledTokens
      .filter(t => t.document.disposition == -1)
      .filter(t => t.actor.system.attributes.hp.value > 0);

    if (hostileTokens.length <= 0)
      return;

    let exitTokenGridPos = this.getTokenGridPos(exitToken);

    let hostilePlan = await this.getHostilesPlan(hostileTokens, exitTokenGridPos);
    if (hostilePlan.length <= 0)
      return;

    let activeHostileTokens = hostilePlan.map(p => p.token);
    let hostileHpMap = this.getTokenHpMap(activeHostileTokens);

    let friendlyTokens = enabledTokens
      .filter(t => t.document.disposition == 1);

    let entrancePos = {x:entranceToken.document.x, y:entranceToken.document.y};
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

  async getHostilesPlan(hostileTokens, exitPos) {
    let hostilePlan = [];
    for (let t of hostileTokens) {
      let plan = await this.getTokenPlannedPath(t, exitPos);
      if (plan)
        hostilePlan.push(plan);
    }
      
    hostilePlan.sort((a, b) => {
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

  async moveTokenOffset(token, dx, dy, options) {
    const tdPos = this.getTokenGridPos(token);
    await this.moveTokenFromTo(token, {x:tdPos[1], y:tdPos[0]}, {x:tdPos[1]+dx,y:tdPos[0]+dy}, options);
  }

  async moveTokenFromTo(token, from, to, options) {
    let pathRes = await routinglib.calculatePath(from, to, {interpolate:false});
    let path = pathRes.path;
    await this.moveTokenAlongPath(token, path, options);
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

  async getTokenPlannedPath(token, endGridPos) {
    const td = token.document;
    const grid = canvas.grid.grid;
    const tdGridPos = grid.getGridPositionFromPixels(td.x, td.y);

    const path = await routinglib.calculatePath(this.gridPosToPathPos(tdGridPos), this.gridPosToPathPos(endGridPos), {interpolate:false});
    if (path == null)
      return null;
    return {
      token: token,
      path: path
    }
  }
}