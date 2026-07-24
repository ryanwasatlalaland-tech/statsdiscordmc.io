# statsdiscordmc
WIP dashboard to track Minecraft Discord Joins/Leaves and Message activity mostly for my own curiosity but who knows what it will morph into 

# Created as a fully open Server Insights style analytics for all

All pulls of Invite data are handled by a Cloudflare Flare worker, Githubs Actions just did not cut it as it was unreliable to say the least. Cloudflare updates every 5 mins but sometimes this can be delayed for a number of reasons including the link failing 
