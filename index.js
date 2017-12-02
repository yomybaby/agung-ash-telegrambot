require('dotenv').config()

const inside = require('point-in-polygon');
const rp = require('request-promise-native');
const cheerio = require('cheerio')
const moment = require('moment-timezone');
const _ = require('lodash');
const Telegraf = require('telegraf');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const bot = new Telegraf(process.env.BOT_TOKEN)
    
let latestAshData = [];
let updatedMoment;

moment.tz.setDefault('Asia/Brunei'); //+08:00 Bali

// redis.hgetall('chatList').then(function (result) {
//   console.log(result);
//   _.each(result, (value, chatId)=>{
//     bot.telegram.sendMessage(chatId, value);
//   });
// });

// update ash data every 5 minutes
setInterval(function () {
  console.log('updated at ' + moment().format('LLL'));
  updateAshData();
},5*60*1000);

updateAshData().then(function (){
  bot.start((ctx) => {
    console.log('started:', ctx.from.id)
    ctx.replyWithMarkdown(
`Welcome!👐

I am Agung Ash Bot for your safety.
I will let you know wether you are in ash area or not based on ash prediction data from [bom.gov.au](http://www.bom.gov.au/products/IDD65300.shtml). *I'm not sure the result from me is correct. Please check again* [original source](http://www.bom.gov.au/products/IDD65300.shtml).

Take care! 🙏`);
    return ctx.replyWithMarkdown('Avaliable commands:\n/check\nCheck current location ash state.\n\n/developer\nAre you a developer? please make this bot together', Telegraf.Extra.markup((markup) => {
      return markup.resize()
      .keyboard([
        markup.locationRequestButton('📍 Check my location 😷 or 😃')
      ])
    }));
  })
  bot.command('help', (ctx) => ctx.reply('Try send a sticker!'))
  bot.command('developer', (ctx) => ctx.replyWithMarkdown(`I'm made by JongEun Lee. My source code is available on [github](https://github.com/yomybaby/agung-ash-telegramBot).\n\nIf you want buy 🍺 for Jong, go Outpost and find him. 🙏`));
  bot.command('check', (ctx) => ctx.replyWithMarkdown('Please, press a button on the bottom.', Telegraf.Extra.markup((markup) => {
    return markup.resize()
    .keyboard([
      markup.locationRequestButton('📍 Check my location 😷 or 😃')
    ])
    // .oneTime()
  }))
  );
  bot.on('location',  (ctx) => {
    const {location} = ctx.message;

    const currentLocation = [location.latitude, location.longitude];

    let message = '*Your Location Ash Prediction*\n\n';
    const ashState = [];
    latestAshData.forEach(function (data) {
      // message+=`${data.hours?('+'+data.hours+'h'):'current'} : ${
      let isInside = inside( currentLocation, data.pointers );
      ashState.push(isInside);
      message+=`${
        isInside?'😷':'😃'
      } ${updatedMoment.clone().add(data.hours,'h').format('HH:mma DD/MM')}\n`
    })
    message +=`\nsource from [bom.gov.au](http://www.bom.gov.au/products/IDD65300.shtml) at ${updatedMoment.format('LLL')}`
    
    const currentChatInfo = {};
    currentChatInfo[ctx.message.chat.id] = JSON.stringify({
      ashState,
      location : currentLocation
    });
    redis.hmset('chatList', currentChatInfo);
    
    ctx.message.chat.id
    return ctx.replyWithMarkdown(message);
    // http://www.bom.gov.au/products/IDD65300.shtml

  })

  if(process.env.NODE_ENV === 'production') {

    bot.telegram.setWebhook(`${process.env.SERVER_URL}/bot${process.env.BOT_TOKEN}`);
    bot.startWebhook(`/bot${process.env.BOT_TOKEN}`, null, process.env.PORT || 3000);
  } else {
    bot.telegram.deleteWebhook().then(function () {
      bot.startPolling();

    })
  }
});

async function updateAshData() {
  try {
    let htmlString = await rp('http://www.bom.gov.au/products/IDD41300.shtml')

    const $ = cheerio.load(htmlString);
    let preText = $('pre').html();

    updatedMoment = moment(/DTG: (.*)/.exec(preText)[1], 'YYYYMMDD/HHmmZ');
    
    redis.get('dataUpdatedAt').then(function (result) {
      if(result !== updatedMoment.toISOString()){ // if new ash data is comming
        console.log('NEW DATA IS COMMING');
        redis.hgetall('chatList').then(function (listMap) {
          _.each(listMap, (value, chatId) => {
            let chatInfo = JSON.parse(value);
            
            if(chatInfo.location){
              const currentState = [];
              let message = '*Prediction has beend changed.\n\n';
              latestAshData.forEach(function (data) {
                let isInside = inside( chatInfo.location, data.pointers );
                currentState.push(isInside);
                message+=`${
                  isInside?'😷':'😃'
                } ${updatedMoment.clone().add(data.hours,'h').format('HH:mma DD/MM')}\n`
              });
              
              if(!_.isEqual(currentState, chatInfo.ashState)){
                bot.telegram.sendMessage(chatId, message);
              }
            }
          })
        })
      }
      
      redis.set('dataUpdatedAt',updatedMoment.toISOString());
    })
    
    
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

    // console.log(JSON.st||ringify(ashData));

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
