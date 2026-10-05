"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ItemStatus = "I bruk" | "Lagret" | "Til salgs" | "Utlånt";
type Item = {
  id:string; name:string; category:string; brand:string; model:string;
  locationId:string; detail:string; condition:string; value:number; paid:number;
  serial:string; notes:string; image?:string; createdAt:string;
  status?:ItemStatus; loanedTo?:string; saleTitle?:string; saleDescription?:string;
  saleCategory?:string; salePrice?:number;
};
type Location = { id:string; name:string; detail:string; icon:string; kind?:string; note?:string; image?:string };
type View = "home"|"items"|"sell"|"more"|"places";
type AddMode = "camera"|"manual";
type CardID = "items"|"search"|"camera"|"addItem"|"sell"|"documents"|"loans"|"value"|"photos"|"sharing"|"backup";
type UserInfo = { id:string; email:string; displayName:string };
type Household = { id:string; name:string; ownerId:string; role:string };
type PlanInfo = { plan:"free"|"pro"; source?:string; validUntil?:string|null };
type AccountState = { user:UserInfo; households:Household[]; plan:PlanInfo } | null;

const API_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";
const TOKEN_KEY = "mine-ting-cloud-token-v1";
const HOUSEHOLD_KEY = "mine-ting-household-v1";

const defaultLocations:Location[] = [
  {id:"stue",name:"Stue",detail:"Rom",icon:"⌂",kind:"Rom"},
  {id:"kjokken",name:"Kjøkken",detail:"Rom",icon:"⌂",kind:"Rom"},
  {id:"bod",name:"Bod",detail:"Oppbevaring",icon:"▦",kind:"Bod"},
  {id:"garasje",name:"Garasje",detail:"Garasje",icon:"▣",kind:"Garasje"}
];
const categories=["Elektronikk","Verktøy","Møbler","Kjøkken","Samling","Klær","Sport","Hobby","Annet"];
const money=new Intl.NumberFormat("nb-NO",{style:"currency",currency:"NOK",maximumFractionDigits:0});
const uid=()=>typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():`${Date.now()}-${Math.random()}`;

const homeCards:{id:CardID;title:string;subtitle:string;symbol:string}[]=[
  {id:"items",title:"Ting",subtitle:"Se alle ting som er registrert på dette stedet.",symbol:"▣"},
  {id:"search",title:"Finn en ting",subtitle:"Søk etter navn, merke, modell, serienummer eller plassering.",symbol:"⌕"},
  {id:"camera",title:"Registrer med kamera",subtitle:"Ta bilde og la Mine Ting forsøke å kjenne igjen gjenstanden.",symbol:"◎"},
  {id:"addItem",title:"Legg til ting",subtitle:"Registrer manuelt med plassering, verdi og kjøpsopplysninger.",symbol:"+"},
  {id:"sell",title:"Selg",subtitle:"Lag et ferdig annonseutkast med bilder og opplysninger.",symbol:"◇"},
  {id:"documents",title:"Dokumenter",subtitle:"Kvitteringer, garantier, manualer og annen dokumentasjon.",symbol:"▤"},
  {id:"loans",title:"Utlånt",subtitle:"Hold oversikt over hvem som har lånt ting.",symbol:"♙"},
  {id:"value",title:"Verdi",subtitle:"Se kjøpspris og anslått verdi for tingene dine.",symbol:"↗"},
  {id:"photos",title:"Bilder",subtitle:"Bildeoversikt for tingene på dette stedet.",symbol:"▧"},
  {id:"sharing",title:"Del sted",subtitle:"Del Mine Ting med andre i husstanden.",symbol:"⊕"},
  {id:"backup",title:"Sikkerhetskopi",subtitle:"Eksporter eller importer en kopi av steder og ting.",symbol:"⇩"}
];

async function compressImage(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
        const ctx=canvas.getContext("2d");
        if(!ctx)return reject(new Error("Kunne ikke behandle bildet"));
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg",.78));
      };
      img.onerror=reject; img.src=String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function normalizeLocations(value:unknown):Location[]{
  if(!Array.isArray(value))return defaultLocations;
  return value.map((raw:any)=>({
    id:String(raw.id||uid()),name:String(raw.name||"Sted"),detail:String(raw.detail||raw.kind||"Sted"),
    icon:String(raw.icon||"⌂"),kind:String(raw.kind||raw.detail||"Sted"),note:String(raw.note||""),
    image:typeof raw.image==="string"?raw.image:undefined
  }));
}
function normalizeItems(value:unknown):Item[]{
  if(!Array.isArray(value))return [];
  return value.map((raw:any)=>({
    id:String(raw.id||uid()),name:String(raw.name||"Uten navn"),category:String(raw.category||"Annet"),
    brand:String(raw.brand||""),model:String(raw.model||""),locationId:String(raw.locationId||""),
    detail:String(raw.detail||""),condition:String(raw.condition||"Brukt"),value:Number(raw.value||0),paid:Number(raw.paid||0),
    serial:String(raw.serial||""),notes:String(raw.notes||""),image:typeof raw.image==="string"?raw.image:undefined,
    createdAt:String(raw.createdAt||new Date().toISOString()),status:(raw.status||"I bruk") as ItemStatus,
    loanedTo:String(raw.loanedTo||""),saleTitle:String(raw.saleTitle||""),saleDescription:String(raw.saleDescription||""),
    saleCategory:String(raw.saleCategory||""),salePrice:Number(raw.salePrice||0)
  }));
}

async function jsonFetch(url:string, init?:RequestInit){
  const response=await fetch(url,init);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data.error||`HTTP ${response.status}`) as Error&{status?:number;code?:string};
    error.status=response.status; error.code=data.code; throw error;
  }
  return data;
}

export default function Page(){
  const [view,setView]=useState<View>("home");
  const [items,setItems]=useState<Item[]>([]);
  const [locations,setLocations]=useState<Location[]>(defaultLocations);
  const [selectedPlaceID,setSelectedPlaceID]=useState(defaultLocations[0].id);
  const [ready,setReady]=useState(false);
  const [query,setQuery]=useState("");
  const [statusFilter,setStatusFilter]=useState("Alle");
  const [addOpen,setAddOpen]=useState(false);
  const [addMode,setAddMode]=useState<AddMode>("manual");
  const [placeOpen,setPlaceOpen]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false);
  const [saleItemID,setSaleItemID]=useState("");
  const [toast,setToast]=useState("");
  const [isCustomizing,setIsCustomizing]=useState(false);
  const [cardOrder,setCardOrder]=useState<CardID[]>(homeCards.map(c=>c.id));
  const [hiddenCards,setHiddenCards]=useState<Set<CardID>>(new Set());
  const [draggedCard,setDraggedCard]=useState<CardID|null>(null);
  const [token,setToken]=useState("");
  const [account,setAccount]=useState<AccountState>(null);
  const [householdId,setHouseholdId]=useState("");
  const [cloudState,setCloudState]=useState<"local"|"loading"|"synced"|"saving"|"error">("local");
  const [cloudReady,setCloudReady]=useState(false);
  const importRef=useRef<HTMLInputElement>(null);
  const syncTimer=useRef<number|undefined>(undefined);
  const hydrating=useRef(false);

  const notify=(message:string)=>{setToast(message);window.setTimeout(()=>setToast(""),2400)};

  async function bootstrapCloud(sessionToken:string, preferredHousehold?:string){
    if(!API_URL||!sessionToken)return;
    hydrating.current=true; setCloudState("loading");
    try{
      const me=await jsonFetch(`${API_URL}/me`,{headers:{Authorization:`Bearer ${sessionToken}`},cache:"no-store"});
      const households=(me.households||[]) as Household[];
      const chosen=preferredHousehold&&households.some(h=>h.id===preferredHousehold)?preferredHousehold:households[0]?.id||"";
      setAccount({user:me.user,households,plan:me.plan});
      setToken(sessionToken);
      setHouseholdId(chosen);
      localStorage.setItem(TOKEN_KEY,sessionToken);
      if(chosen)localStorage.setItem(HOUSEHOLD_KEY,chosen);

      if(chosen){
        const snapshot=await jsonFetch(`${API_URL}/snapshot?householdId=${encodeURIComponent(chosen)}`,{headers:{Authorization:`Bearer ${sessionToken}`},cache:"no-store"});
        const cloudItems=normalizeItems(snapshot.data?.items||[]);
        const cloudLocations=normalizeLocations(snapshot.data?.locations||[]);
        const localItems=normalizeItems(JSON.parse(localStorage.getItem("mine-ting-items-v1")||"[]"));
        const localLocations=normalizeLocations(JSON.parse(localStorage.getItem("mine-ting-locations-v1")||"null"));

        const cloudIsEmpty=cloudItems.length===0 && (!snapshot.data?.locations || snapshot.data.locations.length===0);
        const hasLocal=localItems.length>0 || localLocations.length>0;
        if(cloudIsEmpty&&hasLocal){
          await jsonFetch(`${API_URL}/snapshot`,{
            method:"PUT",headers:{"Content-Type":"application/json",Authorization:`Bearer ${sessionToken}`},
            body:JSON.stringify({householdId:chosen,data:{items:localItems,locations:localLocations}})
          });
          setItems(localItems); setLocations(localLocations);
        }else{
          setItems(cloudItems);
          setLocations(cloudLocations.length?cloudLocations:defaultLocations);
        }
      }
      setCloudState("synced"); setCloudReady(true);
    }catch(error:any){
      console.error(error);
      if(error.status===401){
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(HOUSEHOLD_KEY);
        setToken(""); setAccount(null); setHouseholdId(""); setCloudState("local");
      }else setCloudState("error");
    }finally{hydrating.current=false}
  }

  useEffect(()=>{
    let localItems:Item[]=[]; let localLocations:Location[]=defaultLocations;
    try{
      const savedItems=localStorage.getItem("mine-ting-items-v1");
      const savedLocations=localStorage.getItem("mine-ting-locations-v1");
      const savedPlace=localStorage.getItem("mine-ting-selected-place-v2");
      const savedOrder=localStorage.getItem("mine-ting-card-order-v1");
      const savedHidden=localStorage.getItem("mine-ting-card-hidden-v1");
      if(savedItems){localItems=normalizeItems(JSON.parse(savedItems));setItems(localItems)}
      if(savedLocations){localLocations=normalizeLocations(JSON.parse(savedLocations));setLocations(localLocations)}
      if(savedPlace)setSelectedPlaceID(savedPlace);
      if(savedOrder){
        const raw=JSON.parse(savedOrder) as CardID[];
        const valid=raw.filter(id=>homeCards.some(card=>card.id===id));
        const missing=homeCards.map(c=>c.id).filter(id=>!valid.includes(id));
        setCardOrder([...valid,...missing]);
      }
      if(savedHidden)setHiddenCards(new Set(JSON.parse(savedHidden) as CardID[]));
    }catch{}
    setReady(true);
    const savedToken=localStorage.getItem(TOKEN_KEY)||"";
    const savedHousehold=localStorage.getItem(HOUSEHOLD_KEY)||"";
    if(savedToken)bootstrapCloud(savedToken,savedHousehold);

    const params=new URLSearchParams(location.search);
    if(params.get("pro")==="success"){
      notify("Betalingen er registrert. Pro aktiveres så snart Stripe-bekreftelsen er mottatt.");
      history.replaceState({},document.title,location.pathname);
      window.setTimeout(()=>{const t=localStorage.getItem(TOKEN_KEY)||"";if(t)bootstrapCloud(t,localStorage.getItem(HOUSEHOLD_KEY)||"")},1800);
    }else if(params.get("pro")==="cancelled"){
      notify("Betalingen ble avbrutt.");
      history.replaceState({},document.title,location.pathname);
    }
  },[]);

  useEffect(()=>{
    if(!ready)return;
    localStorage.setItem("mine-ting-items-v1",JSON.stringify(items));
    localStorage.setItem("mine-ting-locations-v1",JSON.stringify(locations));
    localStorage.setItem("mine-ting-selected-place-v2",selectedPlaceID);
    localStorage.setItem("mine-ting-card-order-v1",JSON.stringify(cardOrder));
    localStorage.setItem("mine-ting-card-hidden-v1",JSON.stringify([...hiddenCards]));

    if(!token||!householdId||!cloudReady||hydrating.current)return;
    if(syncTimer.current)window.clearTimeout(syncTimer.current);
    setCloudState("saving");
    syncTimer.current=window.setTimeout(async()=>{
      try{
        await jsonFetch(`${API_URL}/snapshot`,{
          method:"PUT",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
          body:JSON.stringify({householdId,data:{items,locations}})
        });
        setCloudState("synced");
      }catch(error:any){
        setCloudState("error");
        if(error.code==="PRO_REQUIRED")notify(error.message);
      }
    },850);
  },[items,locations,selectedPlaceID,cardOrder,hiddenCards,ready,token,householdId,cloudReady]);

  useEffect(()=>{
    if(!locations.some(place=>place.id===selectedPlaceID)&&locations[0])setSelectedPlaceID(locations[0].id);
  },[locations,selectedPlaceID]);

  const selectedPlace=locations.find(place=>place.id===selectedPlaceID)||locations[0];
  const placeItems=useMemo(()=>items.filter(item=>!selectedPlace||item.locationId===selectedPlace.id),[items,selectedPlace]);
  const filteredItems=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return placeItems.filter(item=>{
      const haystack=[item.name,item.brand,item.model,item.serial,item.category,item.detail,item.notes].join(" ").toLowerCase();
      return (statusFilter==="Alle"||(item.status||"I bruk")===statusFilter)&&(!q||haystack.includes(q));
    });
  },[placeItems,query,statusFilter]);

  const totalValue=placeItems.reduce((sum,item)=>sum+Math.max(item.value||0,item.salePrice||0),0);
  const forSaleCount=placeItems.filter(item=>(item.status||"I bruk")==="Til salgs").length;
  const loanedCount=placeItems.filter(item=>(item.status||"I bruk")==="Utlånt"||item.loanedTo).length;
  const isPro=account?.plan?.plan==="pro";

  function openAdd(mode:AddMode){
    if(account&&!isPro&&items.length>=25){notify("Gratisversjonen støtter opptil 25 ting. Pro gir ubegrenset antall.");setAccountOpen(true);return}
    setAddMode(mode);setAddOpen(true);
  }
  function openPlace(){
    if(account&&!isPro&&locations.length>=4){notify("Gratisversjonen støtter opptil 4 steder. Pro gir ubegrenset antall.");setAccountOpen(true);return}
    setPlaceOpen(true);
  }
  function exportData(){
    const blob=new Blob([JSON.stringify({version:3,items,locations},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=`mine-ting-backup-${new Date().toISOString().slice(0,10)}.json`;anchor.click();URL.revokeObjectURL(url);notify("Sikkerhetskopi eksportert");
  }
  async function importData(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;
    try{const data=JSON.parse(await file.text());if(Array.isArray(data.items))setItems(normalizeItems(data.items));if(Array.isArray(data.locations))setLocations(normalizeLocations(data.locations));notify("Sikkerhetskopi importert")}catch{notify("Kunne ikke lese sikkerhetskopien")}
    event.target.value="";
  }
  async function logout(){
    if(token&&API_URL)fetch(`${API_URL}/auth/logout`,{method:"POST",headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});
    localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(HOUSEHOLD_KEY);
    setToken("");setAccount(null);setHouseholdId("");setCloudReady(false);setCloudState("local");setAccountOpen(false);notify("Logget ut");
  }
  async function createInvite(){
    if(!token||!householdId){setAccountOpen(true);notify("Logg inn for å dele Mine Ting.");return}
    try{
      const data=await jsonFetch(`${API_URL}/invite`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({householdId})});
      const shareText=`Bli med i Mine Ting. Invitasjonskode: ${data.code}`;
      if(navigator.share)await navigator.share({title:"Mine Ting",text:shareText});else{await navigator.clipboard.writeText(data.code);notify(`Invitasjonskode ${data.code} er kopiert`)}
    }catch(error:any){
      notify(error.message||"Kunne ikke lage invitasjon.");
      if(error.code==="PRO_REQUIRED")setAccountOpen(true);
    }
  }
  async function upgrade(){
    if(!token){setAccountOpen(true);notify("Opprett eller logg inn på en konto først.");return}
    try{
      const data=await jsonFetch("/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
      if(data.url)location.href=data.url;
    }catch(error:any){notify(error.message||"Kunne ikke starte betalingen.")}
  }
  async function acceptInvite(code:string){
    if(!token)throw new Error("Logg inn først.");
    const data=await jsonFetch(`${API_URL}/invite/accept`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({code})});
    await bootstrapCloud(token,data.householdId);
    notify("Invitasjonen er godtatt.");
  }

  function activateCard(id:CardID){
    switch(id){
      case"items":setView("items");break;
      case"search":setView("items");window.setTimeout(()=>document.getElementById("item-search")?.focus(),80);break;
      case"camera":openAdd("camera");break;
      case"addItem":openAdd("manual");break;
      case"sell":setSaleItemID("");setView("sell");break;
      case"loans":setView("more");window.setTimeout(()=>document.getElementById("loan-section")?.scrollIntoView({behavior:"smooth"}),80);break;
      case"value":setView("more");window.setTimeout(()=>document.getElementById("value-section")?.scrollIntoView({behavior:"smooth"}),80);break;
      case"backup":exportData();break;
      case"documents":notify("Dokumenter kommer i neste web-utvidelse.");break;
      case"photos":notify("Bildeoversikt kommer i neste web-utvidelse.");break;
      case"sharing":createInvite();break;
    }
  }
  function moveDragged(over:CardID){
    if(!draggedCard||draggedCard===over)return;
    setCardOrder(current=>{const next=[...current],from=next.indexOf(draggedCard),to=next.indexOf(over);if(from<0||to<0)return current;next.splice(from,1);next.splice(to,0,draggedCard);return next});
  }

  const topTitle=view==="home"?"":view==="items"?"Ting":view==="sell"?"Selg":view==="places"?"Administrer steder":"Mer";

  return <main className="appRoot">
    <div className="paperLayer" aria-hidden="true"/>
    <div className="appFrame">
      {view!=="home"&&<header className="navBar"><div className="navBarSide">{view==="places"?<button className="iconButton textButton" onClick={()=>setView("more")}>‹ Mer</button>:null}</div><h1>{topTitle}</h1><div className="navBarSide right">{view==="items"&&<button className="iconButton" onClick={()=>openAdd("manual")}>＋</button>}</div></header>}
      <section className="screen">
        {view==="home"&&selectedPlace&&<HomeView locations={locations} selectedPlace={selectedPlace} setSelectedPlaceID={setSelectedPlaceID} placeItems={placeItems} totalValue={totalValue} forSaleCount={forSaleCount} loanedCount={loanedCount} cardOrder={cardOrder} hiddenCards={hiddenCards} isCustomizing={isCustomizing} setIsCustomizing={setIsCustomizing} draggedCard={draggedCard} setDraggedCard={setDraggedCard} moveDragged={moveDragged} toggleCard={id=>setHiddenCards(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})} activateCard={activateCard} setView={setView} openPlace={openPlace} recent={placeItems.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5)} account={account} cloudState={cloudState} openAccount={()=>setAccountOpen(true)}/>}
        {view==="items"&&<ItemsView items={filteredItems} place={selectedPlace} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} openAdd={()=>openAdd("manual")} remove={id=>{if(confirm("Slette denne gjenstanden?"))setItems(current=>current.filter(item=>item.id!==id))}} sell={id=>{setSaleItemID(id);setView("sell")}}/>}
        {view==="sell"&&<SellView items={placeItems} selectedID={saleItemID} setSelectedID={setSaleItemID} updateItem={updated=>setItems(current=>current.map(item=>item.id===updated.id?updated:item))} notify={notify} openAdd={()=>openAdd("manual")}/>}
        {view==="more"&&selectedPlace&&<MoreView place={selectedPlace} items={placeItems} totalValue={totalValue} loanedCount={loanedCount} setView={setView} exportData={exportData} importBackup={()=>importRef.current?.click()} notify={notify} account={account} cloudState={cloudState} openAccount={()=>setAccountOpen(true)} createInvite={createInvite} upgrade={upgrade}/>}
        {view==="places"&&<PlacesView locations={locations} items={items} selectedPlaceID={selectedPlaceID} setSelectedPlaceID={setSelectedPlaceID} remove={id=>{if(items.some(item=>item.locationId===id))return alert("Flytt eller slett ting som er registrert på dette stedet først.");if(confirm("Slette stedet?"))setLocations(current=>current.filter(place=>place.id!==id))}} openAdd={openPlace}/>}
      </section>
      <TabBar view={view} setView={setView} quick={()=>openAdd("manual")}/>
    </div>

    {addOpen&&<AddItemSheet mode={addMode} locations={locations} preferredPlaceID={selectedPlaceID} token={token} close={()=>setAddOpen(false)} notify={notify} save={item=>{setItems(current=>[item,...current]);setAddOpen(false);notify("Gjenstanden er lagret")}}/>}
    {placeOpen&&<AddPlaceSheet token={token} close={()=>setPlaceOpen(false)} save={place=>{setLocations(current=>[...current,place]);setSelectedPlaceID(place.id);setPlaceOpen(false);notify("Stedet er lagt til")}}/>}
    {accountOpen&&<AccountSheet token={token} account={account} householdId={householdId} cloudState={cloudState} close={()=>setAccountOpen(false)} onAuthenticated={async newToken=>{await bootstrapCloud(newToken);setAccountOpen(false);notify("Kontoen er koblet til Mine Ting")}} logout={logout} upgrade={upgrade} acceptInvite={acceptInvite} refresh={()=>token&&bootstrapCloud(token,householdId)}/>}
    <input ref={importRef} hidden type="file" accept="application/json" onChange={importData}/>
    {toast&&<div className="toast">{toast}</div>}
  </main>;
}

function HomeView({locations,selectedPlace,setSelectedPlaceID,placeItems,totalValue,forSaleCount,loanedCount,cardOrder,hiddenCards,isCustomizing,setIsCustomizing,draggedCard,setDraggedCard,moveDragged,toggleCard,activateCard,setView,openPlace,recent,account,cloudState,openAccount}:{
  locations:Location[];selectedPlace:Location;setSelectedPlaceID:(id:string)=>void;placeItems:Item[];totalValue:number;forSaleCount:number;loanedCount:number;cardOrder:CardID[];hiddenCards:Set<CardID>;isCustomizing:boolean;setIsCustomizing:(v:boolean)=>void;draggedCard:CardID|null;setDraggedCard:(id:CardID|null)=>void;moveDragged:(id:CardID)=>void;toggleCard:(id:CardID)=>void;activateCard:(id:CardID)=>void;setView:(v:View)=>void;openPlace:()=>void;recent:Item[];account:AccountState;cloudState:string;openAccount:()=>void
}){
  const visible=cardOrder.filter(id=>isCustomizing||!hiddenCards.has(id));
  return <div className="homePage iosPage">
    <div className="homeTopActions">
      <button className="plainLink" onClick={()=>setView("places")}>Administrer steder</button>
      <button className="accountButton" onClick={openAccount}>{account?.plan.plan==="pro"?<><b>PRO</b><span>✓</span></>:account?<><span>◉</span><small>{cloudLabel(cloudState)}</small></>:<><span>◎</span><small>Konto</small></>}</button>
      <button className="circleTopButton" onClick={openPlace}>＋</button>
    </div>
    <h1 className="mineTitle">Mine Ting</h1>
    <div className="placeScroller" role="list">{locations.map(place=>{const selected=place.id===selectedPlace.id;return <button className="placeChoice" key={place.id} onClick={()=>setSelectedPlaceID(place.id)}><div className="placeAvatar small">{place.image?<img src={place.image} alt=""/>:<span>{place.icon||"⌂"}</span>}{selected&&<b className="checkDot">✓</b>}</div><span className={selected?"selectedText":""}>{place.name}</span></button>})}</div>
    <section className="profileCard glassCard"><div className="placeAvatar large">{selectedPlace.image?<img src={selectedPlace.image} alt=""/>:<span>{selectedPlace.icon||"⌂"}</span>}</div><div className="profileText"><h2>{selectedPlace.name}</h2><p>{selectedPlace.kind||selectedPlace.detail||"Sted"}</p><p>{placeItems.length} ting</p></div><button className="editCircle" onClick={()=>setView("places")}>✎</button></section>
    <div className="identityStrip"><span>⌂ {selectedPlace.kind||selectedPlace.detail||"Sted"}</span>{account&&<span>☁ {cloudLabel(cloudState)}</span>}{selectedPlace.note&&<span>▤ Notat</span>}</div>
    <div className="sectionHeader"><h2>Hjemmekort</h2><button className={isCustomizing?"prominentSmall":"borderedSmall"} onClick={()=>setIsCustomizing(!isCustomizing)}>{isCustomizing?"Ferdig":"☷ Tilpass"}</button></div>
    {isCustomizing&&<p className="helperText">Hold og dra kortene for å endre rekkefølge. Bruk øyet for å skjule kort du ikke trenger.</p>}
    <div className="dashboardGrid">{visible.map(id=>{const card=homeCards.find(v=>v.id===id)!;const badge=cardBadge(id,placeItems,forSaleCount,loanedCount);return <div className={`dashboardCard glassCard ${hiddenCards.has(id)?"cardHidden":""} ${draggedCard===id?"dragging":""}`} key={id} draggable={isCustomizing} onDragStart={()=>setDraggedCard(id)} onDragOver={e=>{e.preventDefault();moveDragged(id)}} onDragEnd={()=>setDraggedCard(null)} onClick={()=>{if(!isCustomizing)activateCard(id)}}>{isCustomizing&&<span className="dragHandle">≡</span>}{isCustomizing&&<button className="eyeButton" onClick={e=>{e.stopPropagation();toggleCard(id)}}>{hiddenCards.has(id)?"◌":"◉"}</button>}{badge&&<span className="badge">{badge}</span>}<span className="cardIcon">{card.symbol}</span><h3>{card.title}</h3><p>{card.subtitle}</p></div>})}</div>
    <div className="statsTwo"><StatCard label="Registrerte ting" value={String(placeItems.length)} symbol="▣"/><StatCard label="Anslått verdi" value={money.format(totalValue)} symbol="kr"/></div>
    <div className="statsThree"><StatCard label="Understeder" value="0" symbol="▦"/><StatCard label="Til salgs" value={String(forSaleCount)} symbol="◇"/><StatCard label="Utlånt" value={String(loanedCount)} symbol="♙"/></div>
    <section className="recentSection"><div className="sectionHeader"><h2>Nylig registrert</h2><button className="plainLink" onClick={()=>setView("items")}>Vis alle</button></div><div className="recentCard glassCard">{recent.length===0?<p className="emptyLine">Ingen ting er registrert på dette stedet ennå.</p>:recent.map((item,index)=><button className="recentRow" key={item.id} onClick={()=>setView("items")}><Thumbnail item={item}/><span className="recentText"><b>{item.name}</b><small>{item.brand||item.category}</small></span><span className="chevron">›</span>{index<recent.length-1&&<i/>}</button>)}</div></section>
  </div>;
}
function cloudLabel(state:string){return state==="synced"?"Synkronisert":state==="saving"?"Lagrer …":state==="loading"?"Henter …":state==="error"?"Synkfeil":"Lokalt"}
function cardBadge(id:CardID,items:Item[],forSale:number,loaned:number){if(id==="items"&&items.length)return String(items.length);if(id==="sell"&&forSale)return String(forSale);if(id==="loans"&&loaned)return String(loaned);if(id==="photos"){const n=items.filter(i=>i.image).length;return n?String(n):undefined}}
function StatCard({label,value,symbol}:{label:string;value:string;symbol:string}){return <div className="statCard glassCard"><span>{symbol}</span><b>{value}</b><small>{label}</small></div>}
function Thumbnail({item,size=54}:{item:Item;size?:number}){return <span className="thumb" style={{width:size,height:size}}>{item.image?<img src={item.image} alt=""/>:<span>▣</span>}</span>}

function ItemsView({items,place,query,setQuery,statusFilter,setStatusFilter,openAdd,remove,sell}:{items:Item[];place?:Location;query:string;setQuery:(v:string)=>void;statusFilter:string;setStatusFilter:(v:string)=>void;openAdd:()=>void;remove:(id:string)=>void;sell:(id:string)=>void}){
  return <div className="iosPage listPage"><div className="searchBar"><span>⌕</span><input id="item-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Navn, merke, modell, serienummer …"/></div><div className="filterRow"><span>{place?.name||"Alle steder"}</span><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>Alle</option><option>I bruk</option><option>Lagret</option><option>Til salgs</option><option>Utlånt</option></select></div>{items.length===0?<EmptyState title="Ingen ting registrert" text="Bruk + for å legge til den første gjenstanden." action="Legg til ting" onClick={openAdd}/>:<div className="iosList">{items.map(item=><div className="iosRow itemRow" key={item.id}><Thumbnail item={item}/><div className="itemText"><b>{item.name}</b><span>{item.brand||item.category}</span><small>⌖ {item.detail||place?.name||"Uten plassering"}</small></div><div className="rowRight">{item.value>0&&<small>{money.format(item.value)}</small>}<div className="rowActions"><button onClick={()=>sell(item.id)}>◇</button><button onClick={()=>remove(item.id)}>×</button></div></div></div>)}</div>}</div>
}

function SellView({items,selectedID,setSelectedID,updateItem,notify,openAdd}:{items:Item[];selectedID:string;setSelectedID:(id:string)=>void;updateItem:(i:Item)=>void;notify:(s:string)=>void;openAdd:()=>void}){
  const selected=items.find(i=>i.id===selectedID);
  if(!items.length)return <div className="iosPage"><EmptyState title="Ingen ting å selge" text="Registrer en ting først, så kan Mine Ting lage annonseutkastet." action="Legg til ting" onClick={openAdd}/></div>;
  if(selected)return <SaleEditor item={selected} back={()=>setSelectedID("")} save={updateItem} notify={notify}/>;
  return <div className="iosPage listPage"><div className="iosList introList"><div className="iosRow introRow"><span className="roundIcon">◇</span><div><b>Gjør ting klare for salg</b><p>Velg en gjenstand. Mine Ting bruker registrerte bilder, merke, modell, tilstand og verdi til å lage et annonseutkast.</p></div></div></div><div className="iosList">{items.map(item=><button className="iosRow saleRow" key={item.id} onClick={()=>setSelectedID(item.id)}><Thumbnail item={item}/><span className="itemText"><b>{item.name}</b><small>{item.saleTitle?"Annonseutkast lagret":"Lag annonse"}</small></span>{(item.status||"I bruk")==="Til salgs"&&<span className="blueSymbol">◇</span>}<span className="chevron">›</span></button>)}</div></div>
}
function SaleEditor({item,back,save,notify}:{item:Item;back:()=>void;save:(i:Item)=>void;notify:(s:string)=>void}){
  const factor:Record<string,number>={"Som ny":.72,"Pent brukt":.58,"Brukt":.43,"Godt brukt":.28};
  const generatedPrice=item.salePrice||item.value||Math.round((item.paid||0)*(factor[item.condition]||.45));
  const generatedTitle=item.saleTitle||`${item.brand?item.brand+" ":""}${item.model?item.model+" – ":""}${item.name}`.trim();
  const generatedDescription=item.saleDescription||`${item.name} selges. Tilstand: ${item.condition.toLowerCase()}.${item.brand?` Merke: ${item.brand}.`:""}${item.model?` Modell: ${item.model}.`:""}${item.notes?` ${item.notes.trim()}`:""}\n\nKan hentes etter avtale. Se bilder for tilstand.`;
  const [title,setTitle]=useState(generatedTitle),[category,setCategory]=useState(item.saleCategory||item.category),[price,setPrice]=useState(generatedPrice?String(generatedPrice):""),[description,setDescription]=useState(generatedDescription);
  const full=[title,category?`Kategori: ${category}`:"",price?`Pris: ${price} kr`:"",description].filter(Boolean).join("\n\n");
  function persist(){save({...item,saleTitle:title.trim(),saleCategory:category.trim(),salePrice:Number(price)||0,saleDescription:description.trim(),status:"Til salgs"});notify("Annonseutkast lagret")}
  async function copy(){await navigator.clipboard.writeText(full);notify("Annonsen er kopiert")}
  return <div className="iosPage formPage"><div className="inlineNav"><button className="plainLink" onClick={back}>‹ Selg</button><b>Lag annonse</b><button className="plainLink" onClick={persist}>Lagre</button></div><div className="formGroup"><div className="summaryRow"><Thumbnail item={item} size={64}/><div><b>{item.name}</b><small>Se gjennom og rediger før du bruker annonsen.</small></div></div></div><div className="groupLabel">ANNONSE</div><div className="formGroup compactFields"><Field label="Tittel"><textarea value={title} onChange={e=>setTitle(e.target.value)} rows={2}/></Field><Field label="Kategoriforslag"><input value={category} onChange={e=>setCategory(e.target.value)}/></Field><Field label="Pris"><input inputMode="numeric" value={price} onChange={e=>setPrice(e.target.value.replace(/\D/g,""))}/></Field><Field label="Beskrivelse"><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={9}/></Field></div><div className="groupLabel">HANDLINGER</div><div className="formGroup actionGroup"><button onClick={copy}>▤ <span>Kopier annonsetekst</span><b>›</b></button><button onClick={()=>{persist();window.open("https://www.finn.no","_blank","noopener,noreferrer")}}>⌁ <span>Åpne FINN</span><b>›</b></button></div><p className="formFootnote">Mine Ting lager et utkast. Du går gjennom opplysningene og fullfører publiseringen hos FINN.</p></div>
}

function MoreView({place,items,totalValue,loanedCount,setView,exportData,importBackup,notify,account,cloudState,openAccount,createInvite,upgrade}:{place:Location;items:Item[];totalValue:number;loanedCount:number;setView:(v:View)=>void;exportData:()=>void;importBackup:()=>void;notify:(s:string)=>void;account:AccountState;cloudState:string;openAccount:()=>void;createInvite:()=>void;upgrade:()=>void}){
  return <div className="iosPage listPage morePage">
    <div className="accountHero glassCard" onClick={openAccount}><span className="accountHeroIcon">{account?"◉":"◎"}</span><div><b>{account?.user.displayName||account?.user.email||"Mine Ting-konto"}</b><p>{account?cloudLabel(cloudState):"Logg inn for synkronisering på iPhone, Android og PC."}</p></div><span className={account?.plan.plan==="pro"?"proChip":"freeChip"}>{account?.plan.plan==="pro"?"PRO":"GRATIS"}</span><span className="chevron">›</span></div>
    {account?.plan.plan!=="pro"&&<section className="planCard glassCard"><div><span className="blueSymbol">✦</span><h3>Mine Ting Pro</h3><p>Ubegrenset antall ting og steder, deling og utvidet AI-analyse.</p></div><button className="primaryButton" onClick={upgrade}>Oppgrader til Pro</button></section>}
    <div className="groupLabel">{place.name.toUpperCase()}</div><div className="iosList menuList"><MenuRow symbol={place.icon||"⌂"} label="Sted" onClick={()=>setView("places")}/><MenuRow symbol="▣" label="Ting" value={String(items.length)} onClick={()=>setView("items")}/><MenuRow symbol="▧" label="Bilder" value={String(items.filter(i=>i.image).length)} onClick={()=>notify("Bildeoversikt kommer i neste web-utvidelse.")}/><MenuRow symbol="▤" label="Dokumenter" onClick={()=>notify("Dokumenter kommer i neste web-utvidelse.")}/><MenuRow symbol="⊕" label={`Del ${place.name}`} onClick={createInvite}/></div>
    <div className="groupLabel">MINE TING</div><div className="iosList menuList"><MenuRow symbol="☷" label="Administrer steder" onClick={()=>setView("places")}/><MenuRow symbol="♙" label="Utlånt" value={String(loanedCount)} onClick={()=>document.getElementById("loan-section")?.scrollIntoView({behavior:"smooth"})}/><MenuRow symbol="↗" label="Verdioversikt" value={money.format(totalValue)} onClick={()=>document.getElementById("value-section")?.scrollIntoView({behavior:"smooth"})}/><MenuRow symbol="⇩" label="Sikkerhetskopi" onClick={exportData}/><MenuRow symbol="⇧" label="Importer sikkerhetskopi" onClick={importBackup}/><MenuRow symbol="▱" label="Installer som app" onClick={()=>notify("På iPhone: Del → Legg til på Hjem-skjerm. På Android: velg Installer app i nettleseren.")}/><MenuRow symbol="⚙" label="Konto og innstillinger" onClick={openAccount}/></div>
    <section id="loan-section" className="overviewPanel glassCard"><span className="blueSymbol">♙</span><div><b>Utlånt</b><p>{loanedCount===0?"Ingen ting er registrert som utlånt.":`${loanedCount} ting er registrert som utlånt.`}</p></div></section>
    <section id="value-section" className="overviewPanel glassCard"><span className="blueSymbol">↗</span><div><b>Verdioversikt</b><p>Anslått verdi for {place.name}: <strong>{money.format(totalValue)}</strong></p></div></section>
  </div>
}
function MenuRow({symbol,label,value,onClick}:{symbol:string;label:string;value?:string;onClick:()=>void}){return <button className="iosRow menuRow" onClick={onClick}><span className="menuSymbol">{symbol}</span><b>{label}</b><span className="menuValue">{value}</span><span className="chevron">›</span></button>}

function PlacesView({locations,items,selectedPlaceID,setSelectedPlaceID,remove,openAdd}:{locations:Location[];items:Item[];selectedPlaceID:string;setSelectedPlaceID:(id:string)=>void;remove:(id:string)=>void;openAdd:()=>void}){
  return <div className="iosPage listPage"><div className="sectionHeader"><p className="helperText">Hovedsteder fungerer som profiler i Mine Ting. Velg for eksempel Stue, Kjøkken, Bod eller Garasje.</p><button className="borderedSmall" onClick={openAdd}>＋ Nytt sted</button></div><div className="iosList placeList">{locations.map(place=>{const count=items.filter(i=>i.locationId===place.id).length,selected=place.id===selectedPlaceID;return <div className="iosRow" key={place.id}><div className="placeAvatar listAvatar">{place.image?<img src={place.image} alt=""/>:<span>{place.icon||"⌂"}</span>}</div><button className="placeMain" onClick={()=>setSelectedPlaceID(place.id)}><b>{place.name}</b><small>{place.kind||place.detail||"Sted"} · {count} ting</small></button>{selected&&<span className="blueSymbol">✓</span>}<button className="deleteButton" onClick={()=>remove(place.id)}>×</button></div>})}</div></div>
}

function TabBar({view,setView,quick}:{view:View;setView:(v:View)=>void;quick:()=>void}){const tab=view==="places"?"more":view;return <nav className="tabBar"><Tab active={tab==="home"} symbol="⌂" label="Hjem" onClick={()=>setView("home")}/><Tab active={tab==="items"} symbol="▣" label="Ting" onClick={()=>setView("items")}/><button className="quickTab" onClick={quick}><span>＋</span><small>Legg til</small></button><Tab active={tab==="sell"} symbol="◇" label="Selg" onClick={()=>setView("sell")}/><Tab active={tab==="more"} symbol="•••" label="Mer" onClick={()=>setView("more")}/></nav>}
function Tab({active,symbol,label,onClick}:{active:boolean;symbol:string;label:string;onClick:()=>void}){return <button className={`tab ${active?"active":""}`} onClick={onClick}><span>{symbol}</span><small>{label}</small></button>}
function EmptyState({title,text,action,onClick}:{title:string;text:string;action:string;onClick:()=>void}){return <div className="emptyState"><span>▣</span><h2>{title}</h2><p>{text}</p><button className="primaryButton" onClick={onClick}>{action}</button></div>}

function AddItemSheet({mode,locations,preferredPlaceID,token,close,save,notify}:{mode:AddMode;locations:Location[];preferredPlaceID:string;token:string;close:()=>void;save:(i:Item)=>void;notify:(s:string)=>void}){
  const [activeMode,setActiveMode]=useState<AddMode>(mode);
  const [image,setImage]=useState("");
  const [busy,setBusy]=useState(false);
  const [analysisMessage,setAnalysisMessage]=useState("");
  const [analysisConfidence,setAnalysisConfidence]=useState<number|null>(null);
  const [saleTitle,setSaleTitle]=useState("");
  const [saleDescription,setSaleDescription]=useState("");
  const [form,setForm]=useState({name:"",category:"Annet",brand:"",model:"",locationId:preferredPlaceID||locations[0]?.id||"",detail:"",condition:"Pent brukt",value:"",paid:"",serial:"",notes:"",status:"I bruk" as ItemStatus,loanedTo:""});
  const fileRef=useRef<HTMLInputElement>(null);

  async function analyze(dataUrl:string){
    if(!token){setAnalysisMessage("Bildet er lagt til. Logg inn på Mine Ting-kontoen for automatisk AI-gjenkjenning.");return}
    setAnalysisMessage("Analyserer bildet …");
    try{
      const data=await jsonFetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:dataUrl,token})});
      const r=data.result||{};
      setForm(current=>({...current,name:r.title||r.genericName||current.name,category:categories.includes(r.category)?r.category:current.category,brand:r.brand||"",model:r.model||"",condition:["Som ny","Pent brukt","Brukt","Godt brukt"].includes(r.conditionSuggestion)?r.conditionSuggestion:current.condition,notes:r.notes||current.notes}));
      setSaleTitle(r.saleTitle||"");setSaleDescription(r.saleDescription||"");setAnalysisConfidence(typeof r.confidence==="number"?r.confidence:null);
      setAnalysisMessage(r.brand||r.model?`Fant: ${[r.brand,r.model,r.title].filter(Boolean).join(" ")}`:`Fant: ${r.title||r.genericName||"gjenstand"}`);
    }catch(error:any){setAnalysisMessage(error.message||"Kunne ikke analysere bildet.");if(error.code==="AI_LIMIT_REACHED")notify(error.message)}
  }
  async function choose(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;setBusy(true);
    try{const dataUrl=await compressImage(file);setImage(dataUrl);if(activeMode==="camera")await analyze(dataUrl);else setAnalysisMessage("Bilde lagt til.")}catch{setAnalysisMessage("Kunne ikke lese bildet.")}finally{setBusy(false)}
  }
  async function done(){
    if(!form.name.trim())return alert("Skriv inn hva gjenstanden er.");
    setBusy(true);
    let storedImage=image||undefined;
    if(token&&image.startsWith("data:image/")){
      try{const uploaded=await jsonFetch("/api/upload-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image,token})});if(uploaded.url)storedImage=uploaded.url}catch{notify("Gjenstanden lagres, men bildet kunne ikke lastes opp til skyen.")}
    }
    save({id:uid(),name:form.name.trim(),category:form.category,brand:form.brand.trim(),model:form.model.trim(),locationId:form.locationId,detail:form.detail.trim(),condition:form.condition,value:Number(form.value)||0,paid:Number(form.paid)||0,serial:form.serial.trim(),notes:form.notes.trim(),image:storedImage,createdAt:new Date().toISOString(),status:form.status,loanedTo:form.loanedTo.trim(),saleTitle,saleDescription,saleCategory:form.category});
  }
  return <div className="sheetBackdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><div className="sheet"><header className="sheetHeader"><button className="plainLink" onClick={close}>Avbryt</button><b>Legg til ting</b><button className="plainLink" disabled={busy} onClick={done}>{busy?"Vent …":"Lagre"}</button></header><div className="segmented"><button className={activeMode==="camera"?"active":""} onClick={()=>setActiveMode("camera")}>◎ Kamera + AI</button><button className={activeMode==="manual"?"active":""} onClick={()=>setActiveMode("manual")}>＋ Manuelt</button></div>{activeMode==="camera"&&<button className="cameraBox" onClick={()=>fileRef.current?.click()}>{image?<img src={image} alt="Valgt bilde"/>:<><span>◎</span><b>{busy?"Behandler bildet …":"Ta bilde eller velg fra bibliotek"}</b><small>Mine Ting forsøker å kjenne igjen gjenstanden automatisk.</small></>}</button>}<input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={choose}/>{analysisMessage&&<div className="aiResult"><span>✦</span><div><b>{analysisMessage}</b>{analysisConfidence!==null&&<small>Sikkerhet: {Math.round(analysisConfidence*100)} %. Kontroller alltid forslagene før lagring.</small>}</div></div>}
    <div className="groupLabel">GRUNNLEGGENDE</div><div className="formGroup compactFields"><Field label="Navn *"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="F.eks. optisk mus"/></Field><Field label="Kategori"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Merke"><input value={form.brand} onChange={e=>setForm({...form,brand:e.target.value})}/></Field><Field label="Modell"><input value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></Field><Field label="Serienummer"><input value={form.serial} onChange={e=>setForm({...form,serial:e.target.value})}/></Field></div>
    <div className="groupLabel">PLASSERING</div><div className="formGroup compactFields"><Field label="Sted"><select value={form.locationId} onChange={e=>setForm({...form,locationId:e.target.value})}>{locations.map(place=><option key={place.id} value={place.id}>{place.name}</option>)}</select></Field><Field label="Hvor nøyaktig?"><input value={form.detail} onChange={e=>setForm({...form,detail:e.target.value})} placeholder="Hylle 2, blå kasse"/></Field></div>
    <div className="groupLabel">VERDI OG STATUS</div><div className="formGroup compactFields"><Field label="Tilstand"><select value={form.condition} onChange={e=>setForm({...form,condition:e.target.value})}>{["Som ny","Pent brukt","Brukt","Godt brukt"].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Status"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value as ItemStatus})}>{["I bruk","Lagret","Til salgs","Utlånt"].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Kjøpspris"><input inputMode="numeric" value={form.paid} onChange={e=>setForm({...form,paid:e.target.value.replace(/\D/g,"")})}/></Field><Field label="Anslått verdi"><input inputMode="numeric" value={form.value} onChange={e=>setForm({...form,value:e.target.value.replace(/\D/g,"")})}/></Field>{form.status==="Utlånt"&&<Field label="Lånt ut til"><input value={form.loanedTo} onChange={e=>setForm({...form,loanedTo:e.target.value})}/></Field>}</div>
    <div className="groupLabel">NOTATER</div><div className="formGroup compactFields"><Field label="Beskrivelse og notater"><textarea rows={5} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></div>
  </div></div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label><span>{label}</span>{children}</label>}

function AddPlaceSheet({token,close,save}:{token:string;close:()=>void;save:(l:Location)=>void}){
  const [name,setName]=useState(""),[kind,setKind]=useState("Rom"),[note,setNote]=useState(""),[image,setImage]=useState("");
  const [busy,setBusy]=useState(false);const fileRef=useRef<HTMLInputElement>(null);
  const symbols:Record<string,string>={Rom:"⌂",Bod:"▦",Garasje:"▣",Skap:"▤",Annet:"○"};
  async function choose(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(file)setImage(await compressImage(file))}
  async function done(){if(!name.trim())return alert("Skriv inn et navn på stedet.");setBusy(true);let stored=image||undefined;if(token&&image.startsWith("data:image/")){try{const up=await jsonFetch("/api/upload-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image,token})});if(up.url)stored=up.url}catch{}}save({id:uid(),name:name.trim(),detail:kind,kind,icon:symbols[kind]||"○",note:note.trim(),image:stored})}
  return <div className="sheetBackdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><div className="sheet smallSheet"><header className="sheetHeader"><button className="plainLink" onClick={close}>Avbryt</button><b>Legg til sted</b><button className="plainLink" disabled={busy} onClick={done}>{busy?"Vent …":"Lagre"}</button></header><button className="avatarPicker" onClick={()=>fileRef.current?.click()}>{image?<img src={image} alt=""/>:<span>{symbols[kind]}</span>}<small>Velg bilde</small></button><input ref={fileRef} hidden type="file" accept="image/*" onChange={choose}/><div className="groupLabel">STED</div><div className="formGroup compactFields"><Field label="Navn"><input value={name} onChange={e=>setName(e.target.value)} placeholder="F.eks. Stue"/></Field><Field label="Type"><select value={kind} onChange={e=>setKind(e.target.value)}>{Object.keys(symbols).map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Notat"><textarea rows={4} value={note} onChange={e=>setNote(e.target.value)}/></Field></div></div></div>
}

function AccountSheet({token,account,householdId,cloudState,close,onAuthenticated,logout,upgrade,acceptInvite,refresh}:{token:string;account:AccountState;householdId:string;cloudState:string;close:()=>void;onAuthenticated:(token:string)=>Promise<void>;logout:()=>void;upgrade:()=>void;acceptInvite:(code:string)=>Promise<void>;refresh:()=>void}){
  const [mode,setMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[displayName,setDisplayName]=useState(""),[invite,setInvite]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(){setBusy(true);setMessage("");try{const path=mode==="login"?"/auth/login":"/auth/signup";const data=await jsonFetch(`${API_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,displayName})});await onAuthenticated(data.token)}catch(error:any){setMessage(error.message||"Kunne ikke logge inn.")}finally{setBusy(false)}}
  async function join(){if(!invite.trim())return;setBusy(true);setMessage("");try{await acceptInvite(invite.trim());setInvite("");setMessage("Invitasjonen er godtatt.")}catch(error:any){setMessage(error.message||"Kunne ikke bruke invitasjonen.")}finally{setBusy(false)}}
  return <div className="sheetBackdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><div className="sheet smallSheet accountSheet"><header className="sheetHeader"><button className="plainLink" onClick={close}>Lukk</button><b>Konto</b><span/></header>
    {!account?<><div className="accountIntro"><span>☁</span><h2>Mine Ting på alle enhetene dine</h2><p>Opprett en konto for å synkronisere ting, steder og bilder mellom iPhone, Android og PC.</p></div><div className="segmented"><button className={mode==="login"?"active":""} onClick={()=>setMode("login")}>Logg inn</button><button className={mode==="signup"?"active":""} onClick={()=>setMode("signup")}>Ny konto</button></div><div className="formGroup compactFields">{mode==="signup"&&<Field label="Navn"><input value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name"/></Field>}<Field label="E-post"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></Field><Field label="Passord"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"}/></Field></div>{message&&<p className="accountMessage">{message}</p>}<button className="primaryButton accountPrimary" disabled={busy} onClick={submit}>{busy?"Vent …":mode==="login"?"Logg inn":"Opprett konto"}</button></>:
    <><div className="accountHero inside"><span className="accountHeroIcon">◉</span><div><b>{account.user.displayName||account.user.email}</b><p>{account.user.email}</p><small>☁ {cloudLabel(cloudState)}</small></div><span className={account.plan.plan==="pro"?"proChip":"freeChip"}>{account.plan.plan==="pro"?"PRO":"GRATIS"}</span></div>
    <div className="groupLabel">ABONNEMENT</div><div className="formGroup accountRows"><div className="accountRow"><span>Plan</span><b>{account.plan.plan==="pro"?"Mine Ting Pro":"Gratis"}</b></div><div className="accountRow"><span>Synkronisering</span><b>{cloudLabel(cloudState)}</b></div><div className="accountRow"><span>Husstand</span><b>{householdId?"Koblet":"Ikke koblet"}</b></div></div>
    {account.plan.plan!=="pro"&&<button className="primaryButton accountPrimary" onClick={upgrade}>Oppgrader til Pro</button>}
    <div className="groupLabel">DELING</div><div className="formGroup compactFields"><Field label="Invitasjonskode"><input value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())} placeholder="Lim inn kode"/></Field></div><button className="secondaryAction" disabled={busy} onClick={join}>Bruk invitasjonskode</button>
    {message&&<p className="accountMessage">{message}</p>}
    <div className="accountActions"><button onClick={refresh}>Synkroniser nå</button><button className="dangerText" onClick={logout}>Logg ut</button></div></>}
  </div></div>
}
