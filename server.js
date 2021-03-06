'use strict';

// app dependiencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

// get proect enviroment variables
require('dotenv').config();

// app constants
const PORT = process.env.PORT;
const app = express();

//handle errors
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('sorry, something broke.');
}

//--------------------------TABLE CONFIG--------------------
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

// app middleware
app.use(cors());


//API route
app.get('/location', getLocation);
// //api route
app.get('/weather', getWeather);
//API route
app.get('/movies', getMovie)
//api route
app.get('/yelp', getReview);
//api routh
app.get('/meetup', getMeetup);
//api routh
app.get('/trail', getTrail);



// -------------------------LOCATION-------------------------
//location constructor - maps model to schema
//Referencing the data from the json files that will include longitude and latitude
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

//call function for location
function getLocation(req, res) {
  const locationHandler = {
    query: req.query.data,
    cacheHit: (results) => {
      res.send(results.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchlocation(req.query.data)
        .then (data => res.send(data));
    },
  };
  Location.lookupLocation(locationHandler);
}

//save location to database
Location.prototype.save = function () {
  let SQL = `
    INSERT INTO locations
    (search_query,formatted_query,latitude,longitude)
    VALUES ($1,$2,$3,$4)
    RETURNING id
    `;
  let values = Object.values(this);
  return client.query(SQL, values);
};

//fetch location from api and save to DB
Location.fetchlocation = (query) => {
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;
  return superagent.get(_URL)
    .then(data => {
      if (! data.body.results.length) {throw 'No Data';}
      else {
        //create and save instance
        let location = new Location(query, data.body.results[0]);
        return location.save()
          .then ( result => {
            location.id = result.rows[0].id
            return location;
          })
        // return location;
      }
    });
};

//find location in the database
Location.lookupLocation=(handler) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1`;
  const values = [handler.query];
  return client.query( SQL, values)
    .then( results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      }
      else {
        handler.cacheMiss();
      }
    })
    .catch( console.error );
};

// -------------------------WEATHER-------------------------
//weather model
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
}

// helper function
function getWeather(req, res) {
  const weatherHandler = {
    location: req.query.data,
    cacheHit: function(result) {
      let weatherAge = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (weatherAge > 30) {
        Weather.deleteByLocationId(Weather.tableName, req.query.data.id);
        this.cacheMiss();
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function() {
      Weather.fetch(req.query.data)
        .then( results => res.send(results) )
        .catch( console.error );
    },
  };

  Weather.lookup(weatherHandler);
}
//save method
Weather.prototype.save = function(id) {
  const SQL = `INSERT INTO weathers (forecast,time,location_id) VALUES ($1,$2,$3);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

//lookup method
Weather.lookup = function(handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        handler.cacheHit(result);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

//fetch method
Weather.fetch = function(location) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;
  return superagent.get(url)
    .then(result => {
      const weatherSummaries= result.body.daily.data.map(day =>{
        const summary = new Weather (day);
        summary.save(location.id);
        return summary;
      });
      return weatherSummaries;
    });
};

// -------------------------YELP-------------------------
function Yelp(items) {
  this.name = items.name;
  this.url = items.url;
  this.image_url = items.image_url;
  this.rating = items.rating;
  this.price = items.price;
}

// helper function
function getReview(req, res) {
  const yelpHandler = {
    location: req.query.data,
    cacheHit: function(result) {
      let yelpAge = (Date.now() - result.rows[0].created_at) / (1000 * 60 * 60);
      if (yelpAge > 24) {
        Yelp.deleteByLocationId(Yelp.tablename, req.query.data.id);
        this.cacheMiss();
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function() {
      Yelp.fetch(req.query.data)
        .then( results => res.send(results))
        .catch(console.error);
    },
  };

  Yelp.lookup(yelpHandler);
}
//save method
Yelp.prototype.save = function(id) {
  const SQL = `INSERT INTO yelps (name,url,image_url,rating,price) VALUES ($1,$2,$3,$4,$5);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

//lookup method
Yelp.lookup = function(handler) {
  const SQL = `SELECT * FROM yelps WHERE name=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        handler.cacheHit(result);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

//fetch method
Yelp.fetch = function(location) {
  const url = `https://api.yelp.com/v3/businesses/search?location=${location.latitude},${location.longitude}`;
  return superagent.get(url)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(result => {
      const yelpSummary = result.body.businesses.map(item => {
        const summary = new Yelp(item)
        summary.save(location.id);
        return summary;
      });
      return yelpSummary;
    });
};

// -------------------------MOVIES-------------------------
function Movie(movie) {
  this.title= movie.title;
  this.image_url = 'https://image.tmdb.org/t/p/w370_and_h556_bestv2/' + movie.poster_path;
  this.overview= movie.overview;
  this.popularity = movie.popularity;
  this.average_votes= movie.average_votes;
  this.total_votes = movie.total_votes;
  this.released_on = movie.released_on;
}

// helper function
function getMovie(req, res) {
  const movieHandler = {
    location: req.query.data,
    cacheHit: function(result) {
      let movieAge = (Date.now()- result.rows[0].created_at) / (1000 * 60 * 60 * 24);
      if (movieAge > 30) {
        Movie.deleteByLocationId(Movie.tableName, req.query.data.id);
        this.cacheMiss();
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function() {
      Movie.fetch(req.query.data)
        .then( results => res.send(results))
        .catch(console.error);
    },
  };

  Movie.lookup(movieHandler);
}
//save method
Movie.prototype.save = function(id) {
  const SQL = `INSERT INTO movies (title,image_url,overview,popularity,average_votes,total_votes,released_on) VALUES ($1,$2,$3,$4,$5,$6,$7);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

//lookup method
Movie.lookup = function(handler) {
  const SQL = `SELECT * FROM movies WHERE title=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        handler.cacheHit(result);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

//fetch method
Movie.fetch = function(location) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${location.search_query}`;
  return superagent.get(url)
    .then(result => {
      console.log('movies results', result.body.results);
      const movieSummary = result.body.results.map(movie => {
        const summary = new Movie(movie);
        summary.save(location.id);
        return summary;
      });
      return movieSummary;
    });
};


//----------------------MEET UP-----------------------------------------------------
function Meetup(meetup) {
  this.link = meetup.link;
  this.name = meetup.name;
  this.creation_date = meetup.creation_date;
  this.host = meetup.host;
}

// helper function
function getMeetup(req, res) {
  const meetupHandler = {
    location: req.query.data,
    cacheHit: function(result) {
      let meetupAge = (Date.now()- result.rows[0].created_at) / (1000 * 60 * 60);
      if (meetupAge > 7){
        Meetup.deleteByLocationId(Meetup.tableName, req.query.data.id);
        this.cacheMiss();
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function() {
      Meetup.fetch(req.query.data)
        .then( results => res.send(results))
        .catch(console.error);
    },
  };

  Meetup.lookup(meetupHandler);
}
//save method
Meetup.prototype.save = function(id) {
  const SQL = `INSERT INTO meetups (link,name,creation_date,host) VALUES ($1,$2,$3,$4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

//lookup method
Meetup.lookup = function(handler) {
  const SQL = `SELECT * FROM meetups WHERE title=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        handler.cacheHit(result);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

//fetch method
Meetup.fetch = function(location) {
  const url = `https://api.meetup.com/2/open_events?&key=${process.env.MEETUP_API_KEY}&sign=true&photo-host=public&lat=${location.latitude}&topic=softwaredev&lon=${location.longitude}&page=20`;
  return superagent.get(url)
    .then(result => {
      console.log('meetups results', result.body.results);
      const meetupSummary = result.body.results.map(meetup => {
        const summary = new Meetup(meetup);
        summary.save(location.id);
        return summary;
      });
      return meetupSummary;
    });
};

// ----------------------------TRAILS----------------------------------------------
function Trail(trail) {
  this.name = trail.name;
  this.location = trail.location;
  this.length = trail.length;
  this.stars = trail.stars;
  this.star_votes = trail.starVotes;
  this.summary = trail.summary;
  this.trail_url = trail.trail_url;
  this.conditions = trail.conditions;
  this.condition_date = trail.conditionDate.split(' ').slice(0, 1).toString();
  this.condition_time = trail.conditionDate.split(' ').slice(1, 2).toString();
}

// helper function
function getTrail(req, res) {
  const trailHandler = {
    location: req.query.data,
    cacheHit: function(result) {
      let trailAge = (Date.now()- result.rows[0].created_at) / (1000 * 60 * 60 * 24);
      if (trailAge > 7) {
        Trail.deleteByLocationId(Trail.tableName, req.query.data.id);
        this.cacheMiss();
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function() {
      Trail.fetch(req.query.data)
        .then( results => res.send(results))
        .catch(console.error);
    },
  };

  Trail.lookup(trailHandler);
}
//save method
Trail.prototype.save = function(id) {
  const SQL = `INSERT INTO trails (name, location,length,stars,star_votes,summary,trail_url,conditions,condition_date,condition_time) VALUES ($1,$2,$3,$4,$5,$6,$,7,$8,$9,$10);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

//lookup method
Trail.lookup = function(handler) {
  const SQL = `SELECT * FROM trails WHERE title=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        handler.cacheHit(result);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

//fetch method
Trail.fetch = function(location) {
  const url = `https://www.hikingproject.com/data/get-trails?lat=${location.latitude}&lon=${location.longitude}&maxDistance=20&key=${process.env.TRAIL_API_KEY}`;
  return superagent.get(url)
    .then(result => {
      console.log('trails results', result.body.results);
      const trailSummary = result.body.results.map(trail => {
        const summary = new Trail(trail);
        summary.save(location.id);
        return summary;
      });
      return trailSummary;
    });
};



app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
