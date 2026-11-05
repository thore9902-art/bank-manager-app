const form=document.getElementById('loginForm'),msg=document.getElementById('message'),btn=document.getElementById('loginButton');
form.addEventListener('submit',async e=>{e.preventDefault();btn.disabled=true;msg.textContent='Checking login...';try{
 const role=form.dataset.role;
 const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value,loginRole:role})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed');
 location.replace('/bank/dashboard');
}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;document.getElementById('password').value='';}});
