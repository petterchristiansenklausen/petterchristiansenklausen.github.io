"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Item = {
  id:string; name:string; category:string; brand:string; model:string;
  locationId:string; detail:string; condition:string; value:number; paid:number;
  serial:string; notes:string; image?:string; createdAt:string;
};
type Location = { id:string; name:string; detail:string; icon:string };
type View = "home"|"items"|"locations"|"sell";

const defaultLocations:Location[] = [
  {id:"stue",name:"Stue",detail:"Skuffer, skap og hyller",icon:"🛋️"},
  {id:"kjokken",name:"Kjøkken",detail:"Skap og skuffer",icon:"🍽️"},
  {id:"bod",name:"Bod",detail:"Kasser og hyller",icon:"📦"},
  {id:"garasje",name:"Garasje",detail:"Hyller og verktøy",icon:"🔧"}
];
const categories=["Elektronikk","Verktøy","Møbler","Kjøkken","Samling","Klær","Sport","Hobby","Annet"];
const money=new Intl.NumberFormat("nb-NO",{style:"currency",currency:"NOK",maximumFractionDigits:0});
const uid=()=>typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():`${Date.now()}-${Math.random()}`;

async function compressImage(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onerror=()=>reject(r.error);
    r.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const max=1200, scale=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement("canvas");
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        const ctx=c.getContext("2d");
        if(!ctx) return reject(new Error("Ingen bildebehandling"));
        ctx.drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL("image/jpeg",.76));
      };
      img.onerror=reject; img.src=String(r.result);
    };
    r.readAsDataURL(file);
  });
}

export default function Page(){
  const [view,setView]=useState<View>("home");
  const [items,setItems]=useState<Item[]>([]);
  const [locations,setLocations]=useState<Location[]>(defaultLocations);
  const [ready,setReady]=useState(false);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("Alle");
  const [addOpen,setAddOpen]=useState(false);
  const [locOpen,setLocOpen]=useState(false);
  const [sellId,setSellId]=useState("");
  const [toast,setToast]=useState("");
  const importRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    try{
      const a=localStorage.getItem("mine-ting-items-v1");
      const b=localStorage.getItem("mine-ting-locations-v1");
      if(a) setItems(JSON.parse(a));
      if(b) setLocations(JSON.parse(b));
    }catch{}
    setReady(true);
  },[]);
  useEffect(()=>{
    if(!ready) return;
    localStorage.setItem("mine-ting-items-v1",JSON.stringify(items));
    localStorage.setItem("mine-ting-locations-v1",JSON.stringify(locations));
  },[items,locations,ready]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return items.filter(i=>{
      const loc=locations.find(l=>l.id===i.locationId)?.name||"";
      const hit=!q||[i.name,i.category,i.brand,i.model,i.detail,i.notes,loc].join(" ").toLowerCase().includes(q);
      return hit&&(category==="Alle"||i.category===category);
    });
  },[items,locations,query,category]);

  const total=items.reduce((s,i)=>s+(Number(i.value)||0),0);
  const selected=items.find(i=>i.id===sellId)||items[0];
  const notify=(m:string)=>{setToast(m);window.setTimeout(()=>setToast(""),2200)};

  function exportData(){
    const blob=new Blob([JSON.stringify({version:1,items,locations},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=`mine-ting-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
    notify("Backup lastet ned");
  }
  async function importData(e:ChangeEvent<HTMLInputElement>){
    const f=e.target.files?.[0]; if(!f) return;
    try{
      const d=JSON.parse(await f.text());
      if(Array.isArray(d.items)) setItems(d.items);
      if(Array.isArray(d.locations)) setLocations(d.locations);
      notify("Backup importert");
    }catch{notify("Kunne ikke lese filen")}
    e.target.value="";
  }

  return <main className="shell">
    <aside className="side">
      <div className="brand"><span>M</span><div><b>Mine Ting</b><small>Mine Apper</small></div></div>
      <nav>
        <Nav active={view==="home"} icon="⌂" label="Oversikt" onClick={()=>setView("home")}/>
        <Nav active={view==="items"} icon="▦" label="Mine ting" badge={items.length} onClick={()=>setView("items")}/>
        <Nav active={view==="locations"} icon="⌖" label="Steder" badge={locations.length} onClick={()=>setView("locations")}/>
        <Nav active={view==="sell"} icon="◈" label="Selg" onClick={()=>setView("sell")}/>
      </nav>
      <div className="sideFoot">
        <button onClick={exportData}>⇩ Eksporter backup</button>
        <button onClick={()=>importRef.current?.click()}>⇧ Importer backup</button>
        <input ref={importRef} hidden type="file" accept="application/json" onChange={importData}/>
        <small>Første versjon lagrer data lokalt i nettleseren.</small>
      </div>
    </aside>

    <section className="content">
      <header className="top">
        <div><span className="eyebrow">DITT HJEM, I ORDEN</span><h1>{view==="home"?"Hei! Hva leter du etter?":view==="items"?"Mine ting":view==="locations"?"Steder i huset":"Gjør en ting klar for salg"}</h1></div>
        <button className="primary" onClick={()=>setAddOpen(true)}>＋ Legg til ting</button>
      </header>

      {view==="home"&&<Home items={items} locations={locations} total={total} query={query} setQuery={setQuery} setView={setView} openAdd={()=>setAddOpen(true)}/>}
      {view==="items"&&<Items items={filtered} all={items} locations={locations} query={query} setQuery={setQuery} category={category} setCategory={setCategory} openAdd={()=>setAddOpen(true)} remove={id=>{if(confirm("Slette denne gjenstanden?"))setItems(p=>p.filter(i=>i.id!==id))}} sell={id=>{setSellId(id);setView("sell")}}/>}
      {view==="locations"&&<Locations items={items} locations={locations} setLocations={setLocations} open={()=>setLocOpen(true)}/>}
      {view==="sell"&&<Sell items={items} locations={locations} selected={selected} sellId={sellId} setSellId={setSellId} notify={notify} openAdd={()=>setAddOpen(true)}/>}
    </section>

    <nav className="bottom">
      <Nav active={view==="home"} icon="⌂" label="Oversikt" onClick={()=>setView("home")}/>
      <Nav active={view==="items"} icon="▦" label="Ting" onClick={()=>setView("items")}/>
      <button className="plus" onClick={()=>setAddOpen(true)}>＋</button>
      <Nav active={view==="locations"} icon="⌖" label="Steder" onClick={()=>setView("locations")}/>
      <Nav active={view==="sell"} icon="◈" label="Selg" onClick={()=>setView("sell")}/>
    </nav>

    {addOpen&&<AddItem locations={locations} close={()=>setAddOpen(false)} save={item=>{setItems(p=>[item,...p]);setAddOpen(false);notify("Gjenstanden er lagret")}}/>}
    {locOpen&&<AddLocation close={()=>setLocOpen(false)} save={loc=>{setLocations(p=>[...p,loc]);setLocOpen(false);notify("Stedet er lagt til")}}/>}
    {toast&&<div className="toast">{toast}</div>}
  </main>;
}

function Nav({active,icon,label,badge,onClick}:{active:boolean;icon:string;label:string;badge?:number;onClick:()=>void}){
  return <button className={`nav ${active?"active":""}`} onClick={onClick}><span>{icon}</span><em>{label}</em>{badge!==undefined&&<b>{badge}</b>}</button>;
}

function Home({items,locations,total,query,setQuery,setView,openAdd}:{items:Item[];locations:Location[];total:number;query:string;setQuery:(s:string)=>void;setView:(v:View)=>void;openAdd:()=>void}){
  return <div className="stack">
    <section className="hero">
      <div><span className="pill">Mine Ting</span><h2>Finn igjen det du eier.<br/>Selg det du ikke trenger.</h2><p>Registrer ting med tekst, bilde eller kamera, fortell hvor de ligger, og lag en ferdig salgsannonse når det er på tide å rydde.</p><div className="actions"><button className="light" onClick={openAdd}>📷 Registrer med kamera</button><button className="glass" onClick={openAdd}>✎ Skriv inn manuelt</button></div></div>
      <div className="path"><div>⌂</div><b>Hvor er den?</b><span>Rom → skap → skuff → hylle</span><p><i>🛋️ Stue</i><strong>›</strong><i>TV-benk</i><strong>›</strong><i>Skuff 2</i></p></div>
    </section>
    <div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Søk etter drill, julepynt, ladekabel eller kamera…" onKeyDown={e=>{if(e.key==="Enter")setView("items")}}/><button onClick={()=>setView("items")}>Søk</button></div>
    <div className="stats"><Stat icon="▦" value={String(items.length)} label="registrerte ting"/><Stat icon="⌖" value={String(locations.length)} label="steder"/><Stat icon="kr" value={money.format(total)} label="estimert verdi"/><Stat icon="◈" value={String(items.filter(i=>i.value>0).length)} label="klare for salg"/></div>
    <div className="cols">
      <section className="panel"><div className="panelHead"><div><span className="eyebrow">NYLIG</span><h3>Sist registrert</h3></div><button onClick={()=>setView("items")}>Se alle →</button></div>{items.length?<div>{items.slice(0,4).map(i=><Mini key={i.id} item={i} loc={locations.find(l=>l.id===i.locationId)}/>)}</div>:<Empty title="Ingen ting registrert ennå" text="Start med noe du ofte leter etter, eller noe du vurderer å selge." button="Legg til første ting" onClick={openAdd}/>}</section>
      <section className="panel sales"><span className="eyebrow">SMART SALG</span><h3>Fra skap til annonse</h3><p>Velg en registrert ting og få en ryddig FINN-klar annonse med tittel, kategori, beskrivelse og prisforslag.</p><div className="adMock"><span>📷</span><div><small>ANNONSEUTKAST</small><b>Tittel, tekst og prisforslag</b><em>Basert på det du har registrert</em></div></div><button className="secondary full" onClick={()=>setView("sell")}>Lag salgsannonse →</button></section>
    </div>
  </div>;
}
function Stat({icon,value,label}:{icon:string;value:string;label:string}){return <div className="stat"><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>}
function Mini({item,loc}:{item:Item;loc?:Location}){return <div className="mini"><div>{item.image?<img src={item.image} alt=""/>:"📦"}</div><section><b>{item.name}</b><span>{loc?.name||"Uten sted"}{item.detail?` · ${item.detail}`:""}</span></section><strong>{item.value?money.format(item.value):""}</strong></div>}
function Empty({title,text,button,onClick}:{title:string;text:string;button:string;onClick:()=>void}){return <div className="empty"><div>📦</div><h4>{title}</h4><p>{text}</p><button className="secondary" onClick={onClick}>{button}</button></div>}

function Items({items,all,locations,query,setQuery,category,setCategory,openAdd,remove,sell}:{items:Item[];all:Item[];locations:Location[];query:string;setQuery:(s:string)=>void;category:string;setCategory:(s:string)=>void;openAdd:()=>void;remove:(id:string)=>void;sell:(id:string)=>void}){
  return <div className="stack"><div className="toolbar"><div className="smallSearch">⌕<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Søk i alle ting…"/></div><select value={category} onChange={e=>setCategory(e.target.value)}><option>Alle</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
    {items.length?<div className="grid">{items.map(i=>{const loc=locations.find(l=>l.id===i.locationId);return <article className="card" key={i.id}><div className="photo">{i.image?<img src={i.image} alt={i.name}/>:<span>📦</span>}<em>{i.category}</em></div><div className="cardBody"><h3>{i.name}</h3><p>⌖ {loc?.name||"Uten sted"}{i.detail?` · ${i.detail}`:""}</p>{i.brand&&<small>{i.brand}{i.model?` ${i.model}`:""}</small>}<footer><b>{i.value?money.format(i.value):"Ingen verdi satt"}</b><div><button title="Lag annonse" onClick={()=>sell(i.id)}>◈</button><button title="Slett" onClick={()=>remove(i.id)}>×</button></div></footer></div></article>})}</div>:<Empty title={all.length?"Ingen treff":"Ingen ting registrert ennå"} text={all.length?"Prøv et annet søk eller filter.":"Legg til noe med kamera eller manuelt."} button="Legg til ting" onClick={openAdd}/>}
  </div>;
}

function Locations({items,locations,setLocations,open}:{items:Item[];locations:Location[];setLocations:(f:(p:Location[])=>Location[])=>void;open:()=>void}){
  const remove=(id:string)=>{if(items.some(i=>i.locationId===id))return alert("Flytt eller slett ting som er registrert på dette stedet først.");if(confirm("Slette stedet?"))setLocations(p=>p.filter(l=>l.id!==id))};
  return <div className="stack"><div className="intro"><p>Lag steder som «Bod», «Skap i gangen» eller «Verktøybenk». På selve tingen kan du skrive mer presist, som «øverste hylle».</p><button className="primary" onClick={open}>＋ Nytt sted</button></div><div className="locGrid">{locations.map(l=>{const n=items.filter(i=>i.locationId===l.id).length;return <article className="locCard" key={l.id}><span>{l.icon}</span><div><h3>{l.name}</h3><p>{l.detail}</p><b>{n} ting</b></div><button onClick={()=>remove(l.id)}>×</button></article>})}</div></div>;
}

function Sell({items,locations,selected,sellId,setSellId,notify,openAdd}:{items:Item[];locations:Location[];selected?:Item;sellId:string;setSellId:(s:string)=>void;notify:(s:string)=>void;openAdd:()=>void}){
  if(!items.length)return <Empty title="Du trenger en registrert ting først" text="Når noe er registrert kan Mine Ting gjøre opplysningene om til en salgsannonse." button="Legg til ting" onClick={openAdd}/>;
  if(!selected)return null;
  const loc=locations.find(l=>l.id===selected.locationId);
  const factor:Record<string,number>={"Som ny":.72,"Pent brukt":.58,"Brukt":.43,"Godt brukt":.28};
  const price=selected.value||Math.round((selected.paid||0)*(factor[selected.condition]||.45));
  const title=`${selected.brand?selected.brand+" ":""}${selected.model?selected.model+" – ":""}${selected.name}`.trim();
  const desc=`${selected.name} selges. Tilstand: ${selected.condition.toLowerCase()}.${selected.brand?` Merke: ${selected.brand}.`:""}${selected.model?` Modell: ${selected.model}.`:""}${selected.notes?` ${selected.notes.trim()}`:""}\n\nKan hentes etter avtale. Se bilder for tilstand.`;
  const copy=async(t:string,n:string)=>{await navigator.clipboard.writeText(t);notify(`${n} kopiert`)};
  return <div className="sellGrid"><section className="panel"><label className="label">Velg ting</label><select className="wide" value={sellId||selected.id} onChange={e=>setSellId(e.target.value)}>{items.map(i=><option value={i.id} key={i.id}>{i.name}</option>)}</select><div className="sellPreview"><div>{selected.image?<img src={selected.image} alt=""/>:"📦"}</div><section><h3>{selected.name}</h3><p>{loc?.name}{selected.detail?` · ${selected.detail}`:""}</p><span>{selected.condition}</span></section></div><div className="tip"><b>Prisforslag</b><strong>{price?money.format(price):"Ingen pris ennå"}</strong><small>En enkel beregning fra dine egne opplysninger – ikke markedsdata.</small></div></section>
    <section className="panel"><span className="eyebrow">FINN-KLAR TEKST</span><h3>Annonseutkast</h3><Ad label="Tittel" value={title} copy={()=>copy(title,"Tittel")}/><Ad label="Kategori" value={selected.category} copy={()=>copy(selected.category,"Kategori")}/><Ad label="Pris" value={price?money.format(price):"Ikke satt"} copy={()=>copy(price?String(price):"","Pris")}/><div className="adField"><div><label>Beskrivelse</label><textarea readOnly value={desc}/></div><button onClick={()=>copy(desc,"Beskrivelse")}>Kopier</button></div><button className="primary full" onClick={()=>copy(`${title}\n\n${desc}\n\nPris: ${price?money.format(price):"Gi bud"}`,"Hele annonsen")}>Kopier hele annonsen</button><p className="fine">Mine Ting lager annonsen. Selve publiseringen på FINN gjøres hos FINN, slik at du ser og godkjenner alt før publisering.</p></section>
  </div>;
}
function Ad({label,value,copy}:{label:string;value:string;copy:()=>void}){return <div className="adField"><div><label>{label}</label><b>{value}</b></div><button onClick={copy}>Kopier</button></div>}

function AddItem({locations,close,save}:{locations:Location[];close:()=>void;save:(i:Item)=>void}){
  const [mode,setMode]=useState<"camera"|"manual">("camera");
  const [image,setImage]=useState("");
  const [busy,setBusy]=useState(false);
  const [f,setF]=useState({name:"",category:"Annet",brand:"",model:"",locationId:locations[0]?.id||"",detail:"",condition:"Pent brukt",value:"",paid:"",serial:"",notes:""});
  const file=useRef<HTMLInputElement>(null);
  async function choose(e:ChangeEvent<HTMLInputElement>){const x=e.target.files?.[0];if(!x)return;setBusy(true);try{setImage(await compressImage(x))}finally{setBusy(false)}}
  function done(){if(!f.name.trim())return alert("Skriv inn hva gjenstanden er.");save({id:uid(),name:f.name.trim(),category:f.category,brand:f.brand.trim(),model:f.model.trim(),locationId:f.locationId,detail:f.detail.trim(),condition:f.condition,value:Number(f.value)||0,paid:Number(f.paid)||0,serial:f.serial.trim(),notes:f.notes.trim(),image:image||undefined,createdAt:new Date().toISOString()})}
  return <div className="backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><div className="modal"><header><div><span className="eyebrow">NY GJENSTAND</span><h2>Legg til i Mine Ting</h2></div><button onClick={close}>×</button></header><div className="tabs"><button className={mode==="camera"?"active":""} onClick={()=>setMode("camera")}>📷 Kamera / bilde</button><button className={mode==="manual"?"active":""} onClick={()=>setMode("manual")}>✎ Manuelt</button></div>{mode==="camera"&&<div className="camera" onClick={()=>file.current?.click()}>{image?<img src={image} alt="Valgt bilde"/>:<><div>📷</div><b>{busy?"Behandler bildet…":"Ta bilde eller velg fra bibliotek"}</b><span>På mobil åpnes kameraet. Bildet lagres sammen med gjenstanden.</span></>}<input ref={file} hidden type="file" accept="image/*" capture="environment" onChange={choose}/></div>}
    <div className="form"><Field label="Hva er det? *"><input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="F.eks. Makita drill"/></Field><Field label="Kategori"><select value={f.category} onChange={e=>setF({...f,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Merke"><input value={f.brand} onChange={e=>setF({...f,brand:e.target.value})} placeholder="Makita"/></Field><Field label="Modell"><input value={f.model} onChange={e=>setF({...f,model:e.target.value})} placeholder="DDF484"/></Field><Field label="Sted"><select value={f.locationId} onChange={e=>setF({...f,locationId:e.target.value})}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Hvor nøyaktig?"><input value={f.detail} onChange={e=>setF({...f,detail:e.target.value})} placeholder="Hylle 2, blå kasse"/></Field><Field label="Tilstand"><select value={f.condition} onChange={e=>setF({...f,condition:e.target.value})}>{["Som ny","Pent brukt","Brukt","Godt brukt"].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Estimert verdi"><input inputMode="numeric" value={f.value} onChange={e=>setF({...f,value:e.target.value.replace(/\D/g,"")})} placeholder="1500"/></Field><Field label="Kjøpspris"><input inputMode="numeric" value={f.paid} onChange={e=>setF({...f,paid:e.target.value.replace(/\D/g,"")})} placeholder="Valgfritt"/></Field><Field label="Serienummer"><input value={f.serial} onChange={e=>setF({...f,serial:e.target.value})} placeholder="Valgfritt"/></Field><Field label="Notater" wide><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} placeholder="Tilbehør, skader, kvittering eller annet som er greit å huske."/></Field></div>
    <footer className="modalActions"><button className="secondary" onClick={close}>Avbryt</button><button className="primary" onClick={done}>Lagre gjenstand</button></footer></div></div>;
}
function Field({label,children,wide}:{label:string;children:React.ReactNode;wide?:boolean}){return <label className={`field ${wide?"wide":""}`}><span>{label}</span>{children}</label>}

function AddLocation({close,save}:{close:()=>void;save:(l:Location)=>void}){
  const [name,setName]=useState(""),[detail,setDetail]=useState(""),[icon,setIcon]=useState("📦");
  return <div className="backdrop"><div className="modal small"><header><div><span className="eyebrow">NYTT STED</span><h2>Hvor oppbevarer du ting?</h2></div><button onClick={close}>×</button></header><div className="form"><Field label="Ikon"><select value={icon} onChange={e=>setIcon(e.target.value)}>{["📦","🛋️","🍽️","🔧","🚪","🛏️","🏠","🧰","🗄️"].map(i=><option key={i}>{i}</option>)}</select></Field><Field label="Navn *"><input value={name} onChange={e=>setName(e.target.value)} placeholder="F.eks. Bod"/></Field><Field label="Beskrivelse" wide><input value={detail} onChange={e=>setDetail(e.target.value)} placeholder="Kasser og hyller"/></Field></div><footer className="modalActions"><button className="secondary" onClick={close}>Avbryt</button><button className="primary" onClick={()=>{if(!name.trim())return alert("Skriv inn et navn.");save({id:uid(),name:name.trim(),detail:detail.trim(),icon})}}>Legg til sted</button></footer></div></div>;
}
