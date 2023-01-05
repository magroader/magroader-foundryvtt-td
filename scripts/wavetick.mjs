const MAXIMUM_ATTACK_TIME = 2000;

export class WaveTick {
  constructor() {

    this._orderedAttackFunctions = [
      ["Bugbear", this, this.getBugbearAttack],
      ["Goblin Archer", this, this.getGoblinArcherAttack],
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
    this._friendlyWallIds = null;
    this._tokenInfoMap = null;
  }

  async performTick() {
    await this.init();
    if (!this._initSuccess)
      return;

    await this.createFriendlyWalls();
    const pathSuccess = await this.calculateHappyPath();

    if (pathSuccess) {
      await this.performHostileMove();
      await this.performFriendlyAttack();
    }

    await this.destroyFriendlyWalls();

    if (!pathSuccess)
      throw new Error ("Unable to create a path from the entrance to the exit");

    const hostilePlan = await this.calculateHostilesPlan();
    return hostilePlan.length > 0;
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

    this._friendlyTokens = this._enabledTokens
      .filter(t => t.document.disposition == 1);

      const entrancePos = {x:this._entrance.document.x, y:this._entrance.document.y};
      this._friendlyTokens.sort((a, b) => {
        const sqDistanceA = this.distanceSq(a.document, entrancePos);
        const sqDistanceB = this.distanceSq(b.document, entrancePos);
        return sqDistanceA-sqDistanceB;
      });

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

    this.setupHostileGridMap(hostilePlan);

    let activeHostileTokens = hostilePlan.map(p => p.token);
    this.setupTokenHpInfo(activeHostileTokens);

    let tokenNameToTokens = {};
    for (let t of this._friendlyTokens) {
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
      let attackDelay = MAXIMUM_ATTACK_TIME / this._friendlyTokens.length;
      await this.sleep(attackDelay);
    }
  }

  getBugbearAttack(token) {
    return this.performSingleRangedAttack(token, 1, 5, "jb2a.greatclub.standard");
  }

  getGoblinArcherAttack(token) {
    return this.performSingleRangedAttack(token, 3, 3, "jb2a.arrow.physical.white");
  }

  performSingleRangedAttack(source, range, damage, animName) {
    const infos = this.getHostileInfosInRangeSortedByHp(source, range);
    if (infos.length == 0)
      return null;

    const nearest = infos[0];
    nearest.hp = nearest.hp - damage;

    return this.performAttackAnim(source, nearest.token, animName, damage);
  }

  getHostileInfosInRangeSortedByHp(sourceToken, range) {
    const sourceGridPos = this.getTokenGridPos(sourceToken);
    const inRange = this.getHostileTokensWithinRange(sourceGridPos, range, false);
    const infos = inRange.map(t => this.getTokenInfo(t));
    
    infos.sort((a, b) => {
      if (a.token && b.token && a.path && b.path) {
        if (a.path.cost == b.path.cost) {
          return b.token.actor.system.attributes.hp.value - a.token.actor.system.attributes.hp.value;
        }
        return a.path.cost - b.path.cost;
      }
      return -1;
    });
    return infos;
  }
  
  getHostileTokensWithinRange(gridPos, range, includeStartPos) {
    const reachableCells = this.getCellsWithinRange(gridPos, range, includeStartPos);

    let hostiles = [];
    for(const cell of reachableCells) {
      const inCell = this._gridPosToHostileTokensMap[cell];
      if (inCell && inCell.length > 0)
         hostiles = hostiles.concat(inCell);
    }

    return hostiles;
  }

  getCellsWithinRange(startGridPos, range, includeStartPos) {
    const grid = canvas.grid.grid;

    const queue = [[startGridPos, 0]];

    const visited = {};
    visited[startGridPos] = true;
    const result = [];
    if (includeStartPos) {
      result.push(startGridPos);
    }

    while (queue.length > 0) {
      const cur = queue.pop();
      const gridPos = cur[0];
      const spaces = cur[1];

      if (spaces < range) {
        const neighbors = grid.getNeighbors(gridPos[0], gridPos[1]);
        for (const n of neighbors) {
          if (visited[n])
            continue;
          result.push(n); 
          visited[n] = true;
          queue.push([n, spaces+1]);
        }
      }
    }

    return result;
  }

  async performAttackAnim(source, target, anim, damage) {
    let s = new Sequence();
    s.effect()
      .atLocation(source.document)
      .stretchTo(target.document)
      .file(anim)
      .waitUntilFinished();
    await s.play();

    let info = this.getTokenInfo(target);
    
    if (info.updatePromise == null)
      info.updatePromise = target.document.actor.applyDamage(damage);
    else 
      info.updatePromise = info.updatePromise.then(() => {target.document.actor.applyDamage(damage)});

    await info.updatePromise;
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
    let tokens = placeables
      .filter(t => t.document.name == name);
    if (tokens.length != 1) {
      throw new Error("Expected a single token named '" + name + "', found " + tokens.length);
    }
    return tokens[0];
  }

  /*
  isWithinSpaces(source, target, gridSquares) {
    const grid = canvas.grid.grid;
    const p0 = new Point(source.document.x, source.document.y);
    const p1 = new Point(target.document.x, target.document.y);
    const dist = grid.measureDistance(p0, p1);
    return dist <= gridSquares;
  }
  */

  getEnabledHostileTokens() {
    return this._enabledTokens
      .filter(t => t.document.disposition == -1)
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