var queryString = require('querystring');
var url = require('url');
var http = require('http');
var cache = require('memory-cache');
var xml2js = require('xml2js');

var port = process.env.PORT || 3000;
var cacheTimeout = 10000; //in ms

console.log('listening on port ' + port);

http.createServer(function (req, res) {
    var url_parts = url.parse(req.url.toLowerCase(), true);
    var query = url_parts.query;
    var uri = url_parts.pathname;

    //console.log('request rx\'ed: ' +  req.url);
    //console.log(uri);
    //console.log(query);

     

    function throw404(msg){
        res.writeHead(404, {
            'Content-Type': 'application/json'
        });
        res.write(JSON.stringify({status:'error', msg: msg}));
        res.end();
    }

    function respond(text){
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=UTF-8'
        });
        res.write(text);
        res.end();
    }

    function respondJson(obj, code){
        res.writeHead(code ? code : 200, {
            'Content-Type': 'application/json'
        });

        var ret = JSON.stringify(obj);

        // see if it requires a callback
        if(query.callback){
            ret = '{0}({1})'.format((query.callback + '').replace(/[^a-zA-Z0-9._$]+/g, ''), ret);
        }else if(query.jsonp){
            ret = '{0}({1})'.format((query.jsonp+ '').replace(/[^a-zA-Z0-9._$]+/g, ''), ret);
        }

        // send the response
        res.write(ret);
        res.end();
    }

    // gets aqhi from environment canada
    function getAqhi(lat, lon, callback){
        var options=
        {
            host: 'aqhi.azurewebsites.net',
            port: 80,
            method: 'GET',
            path: '/find?lat={0}&lon={1}'.format(lat, lon),
            getUrl: function() {return 'http://{0}{1}'.format(this.host, this.path);}
        }
        http.get(options, function(res){
            res.setEncoding('utf8');
            var body = '';

            res.on('data',function(chunk){
                body+=chunk;
            });

            res.on('end',function(){
                try{
                    var data = JSON.parse(body);
                    callback(data);
                }
                catch(e){
                    console.log(e.message);
                    callback()
                }
            });

            res.on('error',function(err){
                // just make sure we call back
                console.log(e.message);
                callback();
            })
        });
    }

    // gets industry pollutants from emitter data (canada data)
    function getIndustryPollutants(lat, lon, callback){

    }

    function getWeather(){
        // determin the type of call
        var weatherCall = getBingWeather;
        if(query.type){
            switch(query.type.toLowerCase()){
                case 'google':
                    console.log('using google');
                    weatherCall = getGoogleWeather;
                    break;
                case 'bing':
                    console.log('using bing');
                    break;
                default:
                    console.log('defaulting to bing');
                    break;
            }
        }
        else{
            console.log('no weather type defaulting to bing');
        }

        // see if we exist in cache first
        // buffer docs - http://nodejs.org/docs/v0.4.8/api/buffers.html
        var cacheKey = new Buffer(req.url.toLowerCase()).toString('base64');
        var cachedValue = cache.get(cacheKey);
        if(cachedValue){
            console.log('returning from cache for ' + cacheKey);
            respondJson(JSON.parse(cachedValue));
        }
        else{
            // location can be name in the form of 'lat,lon' or just a 'city name'
            weatherCall(encodeURIComponent(query.location),
                function(weatherData){
                    // just add some credits so people know where it's coming from
                    weatherData.credits = 'Data is provided by various weather services with current support for Bing/MSN Weather, Google Weather and weather API provided by RedBit Development. Source code available at https://github.com/marteaga/weatherman';

                    // add the aqhi data from env canada\
                    if(query.includeaqhi){
                        getAqhi(weatherData.latitude, weatherData.longitude, function(aqhiData){
                            weatherData.aqhi = aqhiData;
                            var ret = {status: 'ok', data: weatherData};
                            cache.put(cacheKey, JSON.stringify(ret), cacheTimeout );
                            respondJson(ret);
                        });
                    }
                    else{
                        cache.put(cacheKey, JSON.stringify(weatherData), cacheTimeout );
                        respondJson({status: 'ok', data: weatherData});
                    }
                }, 
                function(err){
                    respondJson({status: 'failed', data: err});
                }
            );
        }
    };

    

    // determin what to do
    switch(url_parts.pathname.toLowerCase()){
        case '/find':
            getWeather();
            break;
        default:
        case '/':
        case '/favicon.ico':
            throw404('not available');
            break;
    }
}).listen(port);



// get weather details using bing and normalize to weather object
function findLocationBing(location, callback, errCallback){
    var options={
        host: 'weather.service.msn.com',
        port: 80,
        method: 'GET',
        path: '/find.aspx?outputview=search&weasearchstr={0}'.format(location),
        getUrl: function() {return 'http://{0}{1}'.format(this.host, this.path);}
    };
    http.get(options, function(res){
        res.setEncoding('utf8');
            var body = '';

            res.on('data',function(chunk){
                body+=chunk;
            });

            res.on('end',function(){
                var parser = new xml2js.Parser();
                parser.parseString(body, function(err, result){
                    if(err)
                    {
                        // there was an error                        
                        errCallback(err);
                    }
                    else{
                        // we are good so attempt to get location code
                        callback(result.weatherdata.weather[0]['$'].weatherlocationcode);
                    }
                });
            });
        });
}

// get weather details using bing and normalize to weather object
function getBingWeather(location, callback, errCallback){

    findLocationBing(location,  
        function(locationCode){
            var options={
                host: 'weather.service.msn.com',
                port: 80,
                method: 'GET',
                path: '/data.aspx?src=vista&weadegreetype=C&culture=en-US&wealocations={0}'.format(locationCode),
                getUrl: function() {return 'http://{0}{1}'.format(this.host, this.path);}
            };

            http.get(options, function(res){
                res.setEncoding('utf8');
                    var body = '';

                    res.on('data',function(chunk){
                        body+=chunk;
                    });

                    res.on('end',function(){
                        var parser = new xml2js.Parser();
                        parser.parseString(body, function(err, result){
                            if(err)
                            {
                                // there was an error                        
                                errCallback(err);
                            }
                            else{
                                // we are good so attempt to parse
                                var ret = new WeatherData(options.getUrl());
                                var weatherNode = result.weatherdata.weather[0]['$'];
                                var currentNode = result.weatherdata.weather[0]['current'][0]['$'];
                                ret.city = weatherNode.weatherlocationname;
                                ret.url  = weatherNode.url;
                                ret.condition = currentNode.skytext;
                                ret.tempC = currentNode.temperature;
                                ret.humidity  = currentNode.humidity;
                                ret.feelsLike  = currentNode.feelslike;
                                ret.wind = currentNode.winddisplay;
                                ret.observationPoint = currentNode.observationpoint;
                                ret.observationTime = currentNode.observationtime;
                                ret.date = currentNode.date;
                                ret.icon = '{0}law/{1}.gif'.format(weatherNode.imagerelativeurl, currentNode.skycode);
                                ret.longitude = weatherNode.long;
                                ret.latitude = weatherNode.lat;
                                callback(ret);
                            }
                        });
                    });
            });
        },
        function(err){
            errCallback(err);
        });
}

// get weather details using google and normalize to weather object
function getGoogleWeather(location){
    http.get({
        host: 'www.google.com',
        port: 80,
        method: 'GET',
        path: 'ig/api?weather={0}'.format(location)
    }, function(res){
        res.setEncoding('utf8');
            var body = '';

            res.on('data',function(chunk){
                body+=chunk;
            });

            res.on('end',function(){
                var parser = new xml2js.Parser();
                // NOTE: as of 2012-09-11 I cannot test on my machine
                parser.parseString(body, function(err, result){
                    if(err)
                    {
                        // there was an error                        
                        console.log(err);
                    }
                    else{
                        // we are good so attempt to parse
                        console.log(result);
                    }
                });
            });
        });
}

// just encapsulates weather information so we can normilize all from different services
// to be used with google if they ever unblock me :)
function WeatherData(source){
    // just set the source 
    this.source = source;
    this.city= undefined;
    this.condition= undefined;
    this.tempC= undefined;
    this.tempF= undefined;
    this.humidity= undefined;
    this.feelsLike= undefined;
    this.wind= undefined;
    this.icon= undefined;
    this.url = undefined;
    this.observationPoint = undefined;
    this.observationTime = undefined;
    this.date = undefined;
    this.longitude = undefined;
    this.latitude = undefined;
}

// format function borrowed from http://stackoverflow.com/questions/610406/javascript-equivalent-to-printf-string-format/4673436#4673436
String.prototype.format = function () {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function (match, number) {
        return typeof args[number] != 'undefined'
          ? args[number]
          : match
        ;
    });
};

String.prototype.trim = function () {
    return this.replace(/^\s+|\s+$/g, "");
}
String.prototype.ltrim = function () {
    return this.replace(/^\s+/, "");
}
String.prototype.rtrim = function () {
    return this.replace(/\s+$/, "");
}