const $=selector=>document.querySelector(selector);
const chat=$('#assistantChat');
const input=$('#assistantInput');
const status=$('#assistantStatus');
const send=$('#assistantSend');
const history=[];
let csrf=sessionStorage.getItem('sq_csrf')||'';
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
  status.textContent=config.externalAIConfigured
   ? 'A server-side AI model is configured. Responses may still be unavailable if the model service is down.'
   : 'No language model is configured. The limited local fallback can make starter plans, but it is not equivalent to ChatGPT or Gemini.';
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
  history.push({role:'assistant',content:data.reply});
  if(history.length>12)history.splice(0,history.length-12);
  status.textContent=data.engine==='local'
   ? 'Answered by the limited local rules engine. Configure AI_BASE_URL and AI_MODEL or an OpenAI/Gemini provider for genuine open-ended model reasoning.'
   : 'Answered by the configured language model. Verify important claims.';
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
