(function(root){
  "use strict";
  const names=Object.freeze({
    "travel-demand-planner":"文旅需求规划",
    "travel-service-coordinator":"文旅服务协同",
    "travel-content-lab":"文旅内容创意",
    "travel-marketing-creator":"文旅营销创作",
    "travel-product-designer":"文旅产品设计"
  });
  if(typeof module==="object"&&module.exports)module.exports=names;
  else root.TravelSkillDisplayNames=names;
})(globalThis);
