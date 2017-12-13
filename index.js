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

const TEXTURL = 'http://www.bom.gov.au/products/IDD41305.shtml';
const GRAPHICURL = 'http://www.bom.gov.au/products/IDD65305.shtml';


moment.tz.setDefault('Asia/Brunei'); //+08:00 Bali

// redis.hgetall('chatList').then(function (result) {
//   console.log(result);
// });

// update ash data every 5 minutes
setInterval(function () {
  console.log('updated at ' + moment().format('LLL'));
  updateAshData();
  rp(process.env.SERVER_URL);
},5*60*1000);

updateAshData().then(function (){
  bot.start((ctx) => {
    console.log('started:', ctx.from.id)
    ctx.replyWithMarkdown(
`Welcome!👐

You can check whether your current location is in Mt. Agung's ash cloud coverage or not.
This info is based on a data from [bom.gov.au](${GRAPHICURL}). 

Be safe and enjoy beautiful Bali! 🙏`);
    return ctx.replyWithMarkdown('Avaliable commands are :\n\n/check : Check current location.\n\n/developer : Are you a developer? please make this bot together', Telegraf.Extra.markup((markup) => {
      return markup.resize()
      .keyboard([
        markup.locationRequestButton('📍 Check my location')
      ])
    }));
  })
  bot.command('developer', (ctx) => ctx.replyWithMarkdown(`I'm made by JongEun Lee. My source code is available on [github](https://github.com/yomybaby/agung-ash-telegramBot).\n\nIf you want buy 🍺 for Jong, go Outpost Ubud and find him. 🙏`));
  bot.command('check', (ctx) => ctx.replyWithMarkdown('Please, press "Check my location" button on the bottom to start.', Telegraf.Extra.markup((markup) => {
    return markup.resize()
    .keyboard([
      markup.locationRequestButton('📍 Check my location')
    ])
    // .oneTime()
  }))
  );
  bot.on('location',  async (ctx) => {
    const {location} = ctx.message;

    const currentLocation = [location.latitude, location.longitude];
    
    if( !updatedMoment || moment().diff(updatedMoment, 'days') > 3  || latestAshData.length === 0){
      return ctx.replyWithMarkdown(`Wow! Currently there is no forecast. It might be no ash cloud. 🤗\nYou may check more detail on [bom.gov.au](http://www.bom.gov.au/info/vaac/advisories.shtml)`);
    } else if (latestAshData.length === 0){
      return ctx.replyWithMarkdown(`Wow! Currently there is no forecast. It might be no ash cloud. 🤗\nYou may check more detail on [bom.gov.au](${GRAPHICURL})`);
    }
    
    const generatedAshInfo = generateAshInfo(currentLocation);
    let message = `*Check this forecast for Mt. Agung's ash coverage.*\n${generatedAshInfo.emoMessage}\n\n`;
    message+=generatedAshInfo.message;
    message +=`\nYou may check it on [the ash cloud map of bom.gov.au](${GRAPHICURL}) at ${updatedMoment.format('LT DD/MM')}\n\nMay I alert you when a new forecast comes out(every 3 hours)?`
    
    const currentChatInfo = {};
    
    const previousInfo = JSON.parse( await redis.hget('chatList', ctx.message.chat.id) || {});
    currentChatInfo[ctx.message.chat.id] = JSON.stringify({
      ashState : generatedAshInfo.ashState,
      location : currentLocation,
      alertOnNew : previousInfo.alertOnNew
    });
    redis.hmset('chatList', currentChatInfo);
    ctx.state.savedChatInfo = currentChatInfo[ctx.message.chat.id];
    return ctx.replyWithMarkdown(message, Telegraf.Markup
      .keyboard([
        ['Yes, alert me'], // Row1 with 2 buttons
        ['No, stop it' ]
      ])
      .oneTime()
      .resize()
      .extra()
    );
    // http://www.bom.gov.au/products/IDD65300.shtml

  });
  
  bot.hears('No, stop it', async (ctx)=>{
    await redis.hget('chatList', ctx.message.chat.id).then(function (result) {
      const obj = JSON.parse(result);
      obj.alertOnNew = false;
      const currentChatInfo = {};
      currentChatInfo[ctx.message.chat.id] = JSON.stringify(obj);
      redis.hmset('chatList', currentChatInfo);
    });
    
    return ctx.reply('OK Thanks! If you want again. Please run /check again.')
  });
  
  bot.hears('Yes, alert me', async (ctx)=>{
    await redis.hget('chatList', ctx.message.chat.id).then(function (result) {
      const obj = JSON.parse(result);
      obj.alertOnNew = true;
      const currentChatInfo = {};
      currentChatInfo[ctx.message.chat.id] = JSON.stringify(obj);
      redis.hmset('chatList', currentChatInfo);
    })
    
    return ctx.reply('Great! I\'ll let you know.')
  });

  if(process.env.NODE_ENV === 'production') {

    bot.telegram.setWebhook(`${process.env.SERVER_URL}/bot${process.env.BOT_TOKEN}`);
    bot.startWebhook(`/bot${process.env.BOT_TOKEN}`, null, process.env.PORT || 3000);
  } else {
    bot.telegram.deleteWebhook().then(function () {
      bot.startPolling();

    })
  }
  
  bot.on('text', (ctx) => {
    const message = _.trim(ctx.message.text).replace(/\!/g, '');
    
    const hoCount = _.countBy(message.split(' '), word => word.toLowerCase()==='ho')['true'];
    if(hoCount){
      console.log(hoCount);
      return ctx.reply('🎤 ' + 'ho! '.repeat(hoCount+1));
    } else {
      return ctx.reply('🎤 Say ho!')
    }
  })
});

async function updateAshData() {
  try {
    let htmlString = await rp(TEXTURL)

    const $ = cheerio.load(htmlString);
    let preText = $('pre').html();
    // console.log('PRE HTML : ',preText);
    
    const dtgs = /DTG: (.*)/.exec(preText);
    if(!dtgs){
      console.error('no forecast');
      return;
    }
    updatedMoment = moment(dtgs[1], 'YYYYMMDD/HHmmZ');
    
    redis.get('dataUpdatedAt').then(function (result) {
      if(result !== updatedMoment.toISOString()){ // if new ash data is comming
        console.log('NEW DATA IS COMMING');
        redis.hgetall('chatList').then(function (listMap) {
          _.each(listMap, (value, chatId) => {
            let chatInfo = JSON.parse(value);
    
            if(chatInfo.location){
              const generatedAshInfo = generateAshInfo(chatInfo.location);
    
              // if(chatInfo.alertOnNew || (chatInfo.alertOnChange && !_.isEqual(generatedAshInfo.ashState, chatInfo.ashState))){
              if(chatInfo.alertOnNew){
                let message = `*New prediction published.*\n${generatedAshInfo.emoMessage}\n\n`
                + generatedAshInfo.message;
                message +=`\nYou may check it on [the ash cloud map of bom.gov.au](${GRAPHICURL}) at ${updatedMoment.format('LT DD/MM')}`
                bot.telegram.sendMessage(chatId, message, {
                  parse_mode: 'Markdown'
                });
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
    const convertedPointer = convert2Pointer(obsData[1] + obsData[2]);
    if(convertedPointer !== 'INVALID'){
      ashData.push({
        hours : 0,
        pointers : convertedPointer
      })
    }

    preText.match(/FCST VA CLD \+(\d*) HR: (.*)\n(.*)/g).forEach(function (focastStr) {
      const hours = /\+(\d*)/.exec(focastStr)[1];
      const convertedPointer = convert2Pointer(focastStr);
      if(convertedPointer !== 'INVALID'){
        ashData.push({
          hours,
          pointers : convert2Pointer(focastStr)
        }) 
      }
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
  const points = dataStr.replace(/\s\s+/g, ' ').match(/S\d*\sE\d*/g);
  if(_.isArray(points)){
    return points.map(function (item) {
      let arr = item.split(' ');
      return [
        dms2Decimal(arr[0]),
        dms2Decimal(arr[1]),
      ]
    });
  } else {
    return 'INVALID';
  }
}

function generateAshInfo(currentLocation){
  let message = '';
  const ashState = [];
  latestAshData.forEach(function (data) {
    // message+=`${data.hours?('+'+data.hours+'h'):'current'} : ${
    let isInside = inside( currentLocation, data.pointers );
    ashState.push(isInside);
    message+=`${
      isInside?'in':'out'
    } @ ${updatedMoment.clone().add(data.hours,'h').format('HH a Do MMM')}\n`
  });
  
  return {
    ashState,
    message,
    emoMessage : ashState.map((isInside) => isInside?'😷':'😃').join(' ')
  }
}
