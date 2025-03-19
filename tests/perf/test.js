const http = require('k6/http');
const { check } = require('k6');

export const options = {
    stages: [
        // { duration: '200s', target: 1000 },
        // { duration: '20s', target: 100 },
        // { duration: '30s', target: 200 },
        // { duration: '40s', target: 400 },
        { duration: '300s', target: 100 },
    ],
};

function generateRandomString() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * 7) + 1; // Random length between 1 and 7
    let result = '';

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }

    return result;
}

export default function () {
    // http.get('http://localhost:3000/api-docs');
    // hit the shorten url api with the auth token 
    const params = { 
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer "
        },
}
    
    const payload = JSON.stringify({
    "longUrl": "http://www.shadowdragon.dev",
    "customAlias": generateRandomString(),
    "topic": "test"
    });
    
    const requestOptions = {
    // method: "POST",
    headers: params,
    body: payload,
    redirect: "follow"
    };
    
    const url = 'http://localhost:3000/api/shorten';
    const res = http.post(url, payload, params)

    check(res, { 'status was 200': (res) => res.status == 200, })
    check(res, { 'status was 429': (res) => res.status == 429, })
    check(res, { 'status was 401': (res) => res.status == 401, })
    check(res, { 'status was 400': (res) => res.status == 400, })
    check(res, { 'status was 403': (res) => res.status == 403, })
    check(res, { 'status was 500': (res) => res.status == 500, })
    check(res, { 'status was 404': (res) => res.status == 404, })
    
    
    // ['home', 'homev1', 'homev2', 'SoLevS2', 'igs', 'adata_ssd_s60', 'thZ5PiaC'].forEach((shorturl) => {
    //     const res = http.get(`http://urlshort.shadowdragon.dev/api/shorten/${shorturl}`);
    //     check(res, {'status was 301': (res) => res.status == 301,})
    //     check(res, {'status was 308': (res) => res.status == 308,})
    //     check(res, { 'status was 429': (res) => res.status == 429, })
    //     check(res, { 'status was 404': (res) => res.status == 404, })
    //     check(res, { 'status was 200': (res) => res.status == 200, })
    //     check(res, { 'status was 500': (res) => res.status == 500, })
    //     check(res, { 'status was 401': (res) => res.status == 401, })
    //     check(res, { 'status was 400': (res) => res.status == 400, })
    //     check(res, { 'status was 403': (res) => res.status == 403, })
    // })

    // const res = http.get(`http://urlshort.shadowdragon.dev/api/shorten/home`);
    //     check(res, { 'status was 301': (res) => res.status == 301, })
    //     check(res, { 'status was 302': (res) => res.status == 302, })
    //     check(res, { 'status was 308': (res) => res.status == 308, })
    //     check(res, { 'status was 429': (res) => res.status == 429, })
    //     check(res, { 'status was 404': (res) => res.status == 404, })
    //     check(res, { 'status was 200': (res) => res.status == 200, })
    //     check(res, { 'status was 500': (res) => res.status == 500, })
    //     check(res, { 'status was 401': (res) => res.status == 401, })
    //     check(res, { 'status was 400': (res) => res.status == 400, })
    //     check(res, { 'status was 403': (res) => res.status == 403, })
   
    // const res = http.get(`http://localhost:3000/api/shorten/portfolio`);
    //     check(res, { 'status was 301': (res) => res.status == 301, })
    //     check(res, { 'status was 302': (res) => res.status == 302, })
    //     check(res, { 'status was 308': (res) => res.status == 308, })
    //     check(res, { 'status was 429': (res) => res.status == 429, })
    //     check(res, { 'status was 404': (res) => res.status == 404, })
    //     check(res, { 'status was 200': (res) => res.status == 200, })
    //     check(res, { 'status was 500': (res) => res.status == 500, })
    //     check(res, { 'status was 401': (res) => res.status == 401, })
    //     check(res, { 'status was 400': (res) => res.status == 400, })
    //     check(res, { 'status was 403': (res) => res.status == 403, })
}
