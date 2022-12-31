export class TowerDefense {    
  init() {
    this.isTicking = false;
  }

  async tick() {
    if (this.isTicking)
      return;
    this.isTicking = true;
    
    try {
      await this.performTick();
    } catch (error) {
      console.error(error);
    }
    this.isTicking = false;
  }

  async performTick() {

    let tokenLayer = canvas.tokens;
    let placeables = Array.from(tokenLayer.placeables);

    let exitA = placeables
      .filter(t => t.document.name == "Exit");
    if (exitA.length != 1) {
      console.error("Expected a single token named 'Exit', found " + exitA.length);
      return;
    }
    let exitToken = exitA[0];
    let exitTokenPos = this.getTokenGridPos(exitToken);
    
    let enabledTokens = placeables
      .filter(t => !t.document.hidden);

    let friendlyTokens = enabledTokens
      .filter(t => t.document.disposition == 1);

    let hostileTokens = enabledTokens
      .filter(t => t.document.disposition == -1);

    if (hostileTokens.length <= 0)
      return;

    let hostilePlan = [];
    for (let t of hostileTokens) {
      let plan = await this.getTokenPlannedPath(t, exitTokenPos);
      console.warn(plan);
      if (plan)
        hostilePlan.push(plan);
    }
      
    hostilePlan.sort((a, b) => {
      return a.path.cost - b.path.cost;
    });
    hostilePlan = hostilePlan.filter(p => p.path.cost > 0);
    if (hostilePlan.length <= 0)
      return;

    let hostileMoveProm = [];
    for(let hp of hostilePlan) {
      let p = this.moveTokenAlongPath(hp.token, hp.path.path, {maxSteps:4});
      hostileMoveProm.push(p);
      await this.sleep(150);
    }
    await Promise.all(hostileMoveProm);

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