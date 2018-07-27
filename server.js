
const path = require('path');
const fs = require('fs');

const express = require('express');
const server = express();

server.set('port', 8080);

server.set('views', __dirname);
server.set('view engine', 'ejs');


//================================================
// Database
//================================================

const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve('db.db');

var db;

try {
	fs.accessSync(DB_PATH, fs.constants.R_OK | fs.constants.W_OK);
	// db exists, open it
	db = new sqlite3.Database(DB_PATH);
}
catch (err) {
	if ( err.code === 'ENOENT' ) {
		// db doesn't exist, create it
		db = new sqlite3.Database(DB_PATH);
		resetDatabase();
	}
	else {
		console.error(err);
		process.exit(1);
	}
}

function resetDatabase() {
	console.log("Resetting database...");
	db.serialize(function() {
		db.run("DROP TABLE IF EXISTS OnOffPost");
		db.run("CREATE TABLE OnOffPost ( id ROWID, uuid VARCHAR(50), device VARCHAR(100), startAt BIGINT, stopAt BIGINT )");
	});
}

// Promise wrappers
db.query = function(sql, values) {
	return new Promise(function(resolve, reject) {
		db.all(sql, values, function(err, rows) {
			if ( err )
				reject(err);
			else
				resolve(rows);
		});
	});
}
db.update = function(sql, values) {
	return new Promise(function(resolve, reject) {
		db.run(sql, values, function(err) {
			if ( err )
				reject(err);
			else
				resolve(this);
		});
	});
}

db.escape = require('sqlstring').escape;


//================================================
// Routes
//================================================

server.use( require('body-parser').json() );

server.get('/', function(req, res) {
	// Period = last 24 hours
	var begin = new Date();
	begin.setHours(begin.getHours()-24);
	var end = new Date();

	// Find stored intervals crossing the selected period
	// Include unfinished intervals (stopAt=0)
	db.query("SELECT * FROM OnOffPost WHERE startAt < ? AND (stopAt > ? OR stopAt=0) ORDER BY startAt DESC", [ end.getTime(), begin.getTime() ])
	.then(rows => res.render('view', { begin:begin, rows:rows }))
	.catch(err => {
		console.error(err);
		res.status(500).send();
	});
});

server.post('/post', function(req, res) {
	if ( !req.body )
		return res.status(400).send("missing or invalid body");

	var uuid = req.body.uuid;
	if ( !uuid || typeof(uuid) != 'string' )
		return res.status(400).send("missing or invalid body.uuid");

	var device = req.body.device;
	if ( !device || typeof(device) != 'string' )
		return res.status(400).send("missing or invalid body.device");

	var actions = req.body.actions;
	if ( !actions || !actions.length || typeof(actions) != 'object' )
		return res.status(400).send("missing or invalid body.actions");

	for ( var i=0; i<actions.length; i++ ) {
		if ( !actions[i] || typeof(actions[i]) != 'object' )
			return res.status(400).send("missing or invalid body.actions["+i+"]");
		if ( typeof(actions[i].on) != 'boolean' )
			return res.status(400).send("missing or invalid body.actions["+i+"].on");
		if ( typeof(actions[i].ts) != 'number' || isNaN(actions[i].ts) )
			return res.status(400).send("missing or invalid body.actions["+i+"].ts");
	}

	return Promise.resolve()
	.then(_ => {
		// if first is OFF, find and update previous unfinished ON
		if ( !actions[0].on ) {
			return db.update("UPDATE OnOffPost SET stopAt = ? WHERE stopAt=0 AND startAt < ? AND uuid = ?", [ actions[0].ts, actions[0].ts, uuid ])
			.then(result => {
				if ( result.changes )
					actions.shift();
				else
					actions.unshift({ on:true, ts:actions[0].ts });	// found no unfinished ON, create a fake one
			});
		}
	})
	.then(_ => {
		if ( actions.length ) {
			// build list of intervals to add to database
			// if last action is ON, last interval is unfinished (stopAt=0)
			var rows = [];
			for ( var i=0; i<actions.length; i++ ) {
				if ( actions[i].on ) {
					rows.push("( " + db.escape(uuid)
							+ " , " + db.escape(device)
							+ " , " + actions[i].ts
							+ " , " + (actions[i+1] || {ts:0}).ts
							+ " )");
				}
			}
			return db.update("INSERT INTO OnOffPost ( uuid, device, startAt, stopAt ) VALUES " + rows.join(","));
		}
	})
	.then(_ => res.json({ status:'OK' }))
	.catch(err => {
		console.error(err);
		return res.status(500).send();
	});
});


//================================================
// Start
//================================================

server.listen(server.get('port'), function() {
	console.log("Server running on port:", server.get('port'));
});


//================================================
// Error
//================================================

server.on('error', function onError(err) {
	if ( err.syscall !== 'listen' )
		throw err;

	switch (err.code) {
		case 'EACCES':
			console.error("Port " + server.get('port') + " requires elevated privileges");
			process.exit(1);
			break;
		case 'EADDRINUSE':
			console.error("Port " + server.get('port') + " is already in use");
			process.exit(1);
			break;
		default:
			throw err;
	}
});


//================================================
// Exit
//================================================

process.on('exit', function(code) {
	if ( db ) { 
		db.close();
		delete db;
	}
	console.log("Exiting with code " + code + "...");
});
