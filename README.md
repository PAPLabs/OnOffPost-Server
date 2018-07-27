# On-Off-Post
Application in action
[img]

# Sample server implementation

When pushing SYNC button, client app sends HTTP POST request to server, with the following JSON payload :
```js
{
    uuid: "<UUID>",
    device: "<MODEL> (<MANUFACTURER> <TYPE>) <OS> <VERSION>",
    actions: [
        { on: Boolean, ts: Number },
        ...
    ]
}
```
Application expects any success code (200-399) and doesn't parse response.
The `actions` array contains all actions performed on device since the last successful SYNC.

This is our sample database used to store intervals :
```sql
CREATE TABLE OnOffPost (
    id ROWID,
    uuid VARCHAR(50),
    device VARCHAR(100),
    startAt BIGINT,
    stopAt BIGINT
)
```

Note that it is possible to SYNC while the button is ON, so we end up with an unfinished interval.
We handle this by creating a row with stopAt=0.
The next SYNC operation by this device will start with an OFF action. We can then fetch and finish the previous unfinished interval :
```sql
UPDATE OnOffPost SET stopAt = ? WHERE stopAt=0 AND startAt < ? AND uuid = ?
#values: actions[0].ts, actions[0].ts, uuid
```

One more thing to note is that on first launch, app always start with an "OFF" action.
[img]
This serves two main purposes :
- send a first initial request to server, so you can set up device identification
- if user uninstalled the app while leaving it ON, the OFF action at reinstall will close the unfinished interval.

On the server side, just keep in mind you can possibly receive an OFF action without a prior ON action. In this sample implementation we are simply generating a 0s interval when this happens.
```js
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
```
