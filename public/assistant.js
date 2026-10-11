const $=selector=>document.querySelector(selector);
const chat=$('#assistantChat');
const input=$('#assistantInput');
const status=$('#assistantStatus');
const send=$('#assistantSend');
const history=[];
let csrf=sessionStorage.getItem('sq_csrf')||'';
function appendSources(sources){
 if(!Array.isArray(sources)||!sources.length)return;
 const section=document.createElement('section');
 section.className='assistant-sources';
 const heading=document.createElement('h3');
 heading.textContent='Sources used';
 section.append(heading);
 const list=document.createElement('ol');
 for(const source of sources.slice(0,9)){
  let url;
  try{url=new URL(source.url);if(!['https:','http:'].includes(url.protocol))continue;}catch{continue;}
  const item=document.createElement('li');
  const link=document.createElement('a');
  link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent=String(source.title||source.domain||'Source');
  item.append(link);
  if(source.domain){const domain=document.createElement('span');domain.className='assistant-source-domain';domain.textContent=' — '+source.domain;item.append(domain);}
  if(source.publishedDate){const date=document.createElement('p');date.className='assistant-source-date';date.textContent='Published: '+String(source.publishedDate).slice(0,80);item.append(date);}
  if(source.snippet){const snippet=document.createElement('p');snippet.textContent=String(source.snippet).slice(0,500);item.append(snippet);}
  list.append(item);
 }
 section.append(list);
 chat.append(section);
 chat.scrollTop=chat.scrollHeight;
}
function appendMessage(role,content){
 const node=document.createElement('div');
 node.className='assistant-message '+(role==='user'?'user':'assistant');
 node.textContent=String(content??'');
 chat.append(node);
 chat.scrollTop=chat.scrollHeight;
}
async function request(url,options={}){
 const headers={accept:'application/json',...(options.headers||{})};
 if(options.body){headers['content-type']='application/json';headers['x-csrf-token']=csrf;}
 const response=await fetch(url,{...options,headers,credentials:'same-origin'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Request failed.');
 return data;
}
async function checkConfiguration(){
 try{
  const config=await request('/api/config');
  const modelText=config.externalAIConfigured
   ? 'A server-side language model is configured.'
   : 'No language model is configured; replies use a limited local fallback.';
  const researchText=config.webResearchPremiumConfigured
   ? 'Web research uses the configured Tavily search service.'
   : 'Web research uses Wikipedia as a no-key fallback; this does not cover the whole internet.';
  status.textContent=modelText+' '+researchText;
 }catch{
  status.textContent='Sign in to your SwiftQuote account to use the assistant.';
 }
}
$('#assistantForm').addEventListener('submit',async event=>{
 event.preventDefault();
 const message=input.value.trim();
 if(!message)return;
 if(!csrf)csrf=sessionStorage.getItem('sq_csrf')||'';
 appendMessage('user',message);
 history.push({role:'user',content:message});
 input.value='';
 send.disabled=true;send.textContent='Thinking…';
 status.textContent='Working on your message…';
 try{
  const data=await request('/api/ai/chat',{method:'POST',body:JSON.stringify({message,history:history.slice(0,-1)})});
  appendMessage('assistant',data.reply);
  appendSources(data.sources);
  history.push({role:'assistant',content:data.reply});
  if(history.length>12)history.splice(0,history.length-12);
  const engineText=data.engine==='local'
   ? 'Answered without a language model; synthesis is limited.'
   : 'Answered by the configured language model.';
  const researchText=data.researchStatus==='results'
   ? ' Web sources were retrieved; check the links and dates.'
   : data.researchStatus==='unavailable'
    ? ' Web research was temporarily unavailable, so no web sources were used.'
    : ' No web sources were returned for this message.';
  status.textContent=engineText+researchText;
 }catch(error){
  history.pop();
  appendMessage('assistant','I could not answer that message: '+error.message);
  status.textContent=error.message;
 }finally{
  send.disabled=false;send.textContent='Send';input.focus();
 }
});
$('#assistantClear').addEventListener('click',()=>{
 history.length=0;
 chat.replaceChildren();
 appendMessage('assistant','Conversation cleared. What would you like to work on?');
 status.textContent='Conversation cleared from this page.';
});
checkConfiguration();
