const check = async () =>{
   const resp =  await fetch('https://fms.onmobilise.com/api/health')
    resp.status === 200 ? console.log('API is up and running',await resp.json()) : console.log('API is down');
}   

check();