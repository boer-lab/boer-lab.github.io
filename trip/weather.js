/* Public weather helpers. Trip details remain in the encrypted guide. */
(function (root) {
  const zone = 'America/Denver';
  const dateAt = value => new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const hourAt = value => Number(new Intl.DateTimeFormat('en-US', {timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(value)));
  const numeric = values => values.filter(v => typeof v === 'number' && Number.isFinite(v));
  function summarize(data, date, start=8, end=18, now=Date.now()) {
    const issued = data.properties?.updateTime || data.properties?.generatedAt;
    const hours = (data.properties?.periods || []).filter(p => dateAt(p.startTime)===date && hourAt(p.startTime)>=start && hourAt(p.startTime)<end);
    const temps = numeric(hours.map(p => typeof p.temperature !== 'number' ? null : p.temperatureUnit==='C' ? p.temperature*9/5+32 : p.temperature));
    const rain = numeric(hours.map(p => p.probabilityOfPrecipitation?.value));
    const wind = numeric(hours.flatMap(p => (String(p.windSpeed||'').match(/\d+(?:\.\d+)?/g)||[]).map(Number)));
    const conditions = [...new Set(hours.map(p=>p.shortForecast).filter(Boolean))];
    const stale = !issued || !Number.isFinite(Date.parse(issued)) || now-Date.parse(issued)>12*3600000;
    const text = conditions.join(' ');
    return {available:hours.length>0 && temps.length>0, issued, stale, hours:hours.length, low:temps.length?Math.min(...temps):null, high:temps.length?Math.max(...temps):null, rain:rain.length?Math.max(...rain):null, wind:wind.length?Math.max(...wind):null, conditions, caution:/thunder|snow|freezing|ice|sleet/i.test(text) || (wind.length && Math.max(...wind)>=25), wet:(rain.length && Math.max(...rain)>=50)||/fog/i.test(text)};
  }
  async function json(url, signal) {
    const response = await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/geo+json'}});
    if (!response.ok) throw new Error('Weather service unavailable ('+response.status+')');
    return response.json();
  }
  async function loadPoint(point,date) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),18000);
    try {
      const meta=await json('https://api.weather.gov/points/'+point.lat+','+point.lon,controller.signal);
      const forecast=meta.properties?.forecastHourly;
      if (!forecast || new URL(forecast).origin!=='https://api.weather.gov') throw new Error('Forecast unavailable');
      const [hourly,alerts]=await Promise.allSettled([json(forecast,controller.signal),json('https://api.weather.gov/alerts/active?point='+point.lat+','+point.lon,controller.signal)]);
      if(hourly.status!=='fulfilled') throw hourly.reason;
      return {point,summary:summarize(hourly.value,date),night:summarize(hourly.value,date,21,23),alerts:alerts.status==='fulfilled'?(alerts.value.features||[]).map(a=>a.properties):null};
    } finally {clearTimeout(timer);}
  }
  root.TripWeather={dateAt,hourAt,summarize,loadPoint};
})(typeof window==='undefined'?globalThis:window);
