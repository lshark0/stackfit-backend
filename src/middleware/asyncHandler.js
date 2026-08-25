// Express 4는 async 핸들러 내부에서 발생한 에러(reject된 Promise)를 자동으로 잡지 않습니다.
// 모든 라우트 핸들러를 이걸로 감싸면, 에러가 나도 서버가 멈추거나 요청이 무한 대기하지 않고
// server.js의 에러 핸들러(500 응답)로 안전하게 넘어갑니다.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// router.get/post/put/patch/delete로 등록되는 모든 핸들러(미들웨어 포함)를 자동으로
// asyncHandler로 감싸줍니다. 라우트 파일마다 매 핸들러를 일일이 고칠 필요 없이,
// 라우터 생성 직후 wrapAllRoutes(router) 한 줄만 추가하면 됩니다.
function wrapAllRoutes(router) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  for (const m of methods) {
    const original = router[m].bind(router);
    router[m] = (path, ...handlers) => {
      const wrapped = handlers.map((h) => (typeof h === 'function' ? asyncHandler(h) : h));
      return original(path, ...wrapped);
    };
  }
  return router;
}

module.exports = { asyncHandler, wrapAllRoutes };
