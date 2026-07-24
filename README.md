# statsdiscordmc
WIP dashboard to track Minecraft Discord Joins/Leaves and Message activity mostly for my own curiosity but who knows what it will morph into 

# Created as a fully open Server Insights style analytics for all

All pulls of Invite data are handled by a Cloudflare worker, Githubs Actions just did not cut it as it was unreliable to say the least. Cloudflare updates every 5 mins but sometimes this can be delayed for a number of reasons including the link failing 


# Data

All data collected from the invite link can be downloaded as a CSV or JSON from the dashboard. Not sure what you could do with it but its an option none the less 




# THIS PROJECT ONLY TRACKS THE INVITE LINK, NO PERSONAL MESSAGES OR DISCORD ACCOUNTS ARE BE TRACKED

This would require using a discord bot, and since it would have to be a self bot that would break Discords TOS and also be incredibly creepy to do 
