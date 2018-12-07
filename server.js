'use strict';

// app dependiencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

// app.use(express.urlencoded({ extended: true }));s


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
app.get('/movies', getMovie)
//API route
app.get('/weather', getWeather);
//api route
app.get('/yelp', getReview);

// -------------------------LOCATION-------------------------
//location constructor - maps model to schema
//Referencing the data from the json files that will include longitude and latitude
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

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
      res.send(result.rows);
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
      res.send(result.rows);
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
      res.send(result.rows);
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

app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
