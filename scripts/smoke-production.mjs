const base=(process.env.BRANDSPARQ_BASE_URL||"https://brandsparq.getsparqd.com").replace(/\/$/,"");
const failures=[];
const pass=(name)=>console.log("PASS:",name);
const fail=(name,detail)=>{failures.push(`${name}: ${detail}`);console.error("FAIL:",name,detail);};

async function request(name,url,options={},validate){
  try{
    const response=await fetch(url,options);
    const result=await validate(response);
    if(result===true)pass(name);else fail(name,String(result||`HTTP ${response.status}`));
  }catch(error){fail(name,error instanceof Error?error.message:String(error));}
}

await request("health",`${base}/health`,{headers:{accept:"application/json"}},async response=>{
  if(response.status!==200)return `HTTP ${response.status}`;
  const payload=await response.json().catch(()=>null);
  if(!payload?.ok)return "Health payload is not OK.";
  if(payload?.checks?.some?.(check=>typeof check.detail==="string"))return "Public health leaks detailed diagnostics.";
  return true;
});

await request("login SPA",`${base}/login`,{headers:{accept:"text/html"}},async response=>{
  if(!response.ok)return `HTTP ${response.status}`;
  const body=await response.text();
  return /<html/i.test(body)&&/BrandSparQ|_expo/i.test(body)||"Login route did not return the Expo web app.";
});

const returnTo=encodeURIComponent(`${base}/login`);
await request(
  "Google OAuth start",
  `${base}/v1/auth/google/start?return_to=${returnTo}`,
  {redirect:"manual"},
  async response=>{
    if(![301,302,303,307,308].includes(response.status))return `Expected OAuth redirect, got HTTP ${response.status}`;
    const location=response.headers.get("location")||"";
    return /^https:\/\/accounts\.google\.com\//.test(location)||"OAuth did not redirect to Google.";
  }
);

await request("API auth guard",`${base}/v1/dashboard`,{headers:{accept:"application/json"}},async response=>{
  if(response.status!==401)return `Expected 401 without a session, got HTTP ${response.status}`;
  return true;
});

if(failures.length){
  console.error("\nProduction smoke test FAILED:");
  for(const item of failures)console.error(" -",item);
  process.exit(1);
}
console.log("\nBrandSparQ production smoke test passed.");
