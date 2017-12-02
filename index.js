require('dotenv').config()

const inside = require('point-in-polygon');
const rp = require('request-promise-native');
const cheerio = require('cheerio')
const moment = require('moment');

let latestAshData = [];
let updatedMoment;

updateAshData().then(function (){
  const Telegraf = require('telegraf');
  const bot = new Telegraf(process.env.BOT_TOKEN)
  bot.start((ctx) => {
    console.log('started:', ctx.from.id)
    return ctx.replyWithMarkdown('Welcome!👐\nI am Agung Ash Bot for your safety.\nI will let you know wether you are in ash area or not based on ash prediction data from [bom.gov.au](http://www.bom.gov.au/products/IDD65300.shtml). *I\'m not sure the result from me is always correct. Please check original source.*\n\nTake care! 🙏');
  })
  bot.command('help', (ctx) => ctx.reply('Try send a sticker!'))
  bot.hears('hi', (ctx) => ctx.replyWithMarkdown('Hey there! Please let\n*asdaf*', Telegraf.Extra.markup((markup) => {
    return markup.resize()
    .keyboard([
      // markup.contactRequestButton('Send contact'),
      markup.locationRequestButton('Check my location safe or not')
    ])
    // .oneTime()
  }))
  );
  // bot.hears(/buy/i, (ctx) => ctx.reply('Buy-buy!'))
  // bot.on('sticker', (ctx) => ctx.reply('👍'))
  bot.on('location',  (ctx) => {
    const {location} = ctx.message;
    
    const currentLocation = [location.latitude, location.longitude];
    
    let message = ''
    latestAshData.forEach(function (data) {
      message+=`${data.hours?(data.hours+'h'):'current'} : ${
        inside( currentLocation, data.pointers )?'😷':'😃'
      }\n`
    })
    message +=`\nsource from [bom.gov.au](http://www.bom.gov.au/products/IDD65300.shtml) at ${updatedMoment.format('LLL')}`
    
    return ctx.replyWithMarkdown(message);
    // http://www.bom.gov.au/products/IDD65300.shtml
    
  })

  bot.startPolling();
});

async function updateAshData() {
  try {
    let htmlString = await rp('http://www.bom.gov.au/products/IDD41300.shtml')
    
    const $ = cheerio.load(htmlString);
    let preText = $('pre').html();
    
    updatedMoment = moment(/DTG: (.*)/.exec(preText)[1], 'YYYYMMDD/HHmmZ');
    
    const obsDtg = /[OBS|EST] VA DTG: (.*)/.exec(preText)[1];
    let obsData = /[OBS|EST] VA CLD: (.*)\n(.*)/.exec(preText);
    
    const ashData = [];
    ashData.push({
      hours : 0,
      pointers : convert2Pointer(obsData[1] + obsData[2]) 
    })
    
    preText.match(/FCST VA CLD \+(\d*) HR: (.*)\n(.*)/g).forEach(function (focastStr) {
      const hours = /\+(\d*)/.exec(focastStr)[1];
      ashData.push({
        hours,
        pointers : convert2Pointer(focastStr)
      }) 
    });
    
    // console.log(JSON.stringify(ashData));
    
    latestAshData = ashData;
  } catch (e) {
    console.error(e);
  } finally {
    
  }
}

function dms2Decimal(DDMM){
  let sign = 1;
  if (DDMM.startsWith('S') || DDMM.startsWith('W')){
    sign = -1;
  }
  dmsNumber = parseInt(DDMM.replace(/[ENSW]/,''));
  const num = Math.floor(dmsNumber/100);
  return (num + parseInt((dmsNumber-num*100))/60) * sign;
}

function convert2Pointer(dataStr) {
  return dataStr.replace(/\s\s+/g, ' ').match(/S\d*\sE\d*/g).map(function (item) {
    let arr = item.split(' ');
    return [
      dms2Decimal(arr[0]),
      dms2Decimal(arr[1]),
    ]
  });
}
