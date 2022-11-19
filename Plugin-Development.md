So, what our protocol do is store various collateral for investment, check its price daily for loss and profit and also compare it with other collaterals.

We have four type of units in our contract 

Four Types of Units - 

1) Collateral (tok) - The Collateral that is stored
2) Reference (ref) - Unit that is used to calculate revenue 
3) Target (target) - Unit that is exchanged at a constant rate reference unit, and is unwrapped as much possible eg. for WETH it is ETH
4) Unit of Account (UoA) - The base unit which is used to calculate the overral asset price. For now "USD (Dollars)"

1 REF -> 1 TOK
1 TARGET -> 1 REF
1 USD -> 1 TARGET

1 USD -> 1 TOK

There are functions in the contract that calculate the exchange between - "tok and ref", "ref and target","targe and UoA" and you need to get the values for those functions

Exchange rate Functions:-
1) refPerTok() - {ref/tok}
2) targetPerRef() - {target/ref}
3) pricePerTarget() - {UoA/target}
4) strictPrice() - {UoA/tok} 



---- Other Important Things to Note -----
1) These units can be equal to each other
2) refPerTok can never be decreasing 
3) There is status value of each collateral, the status will be marked as Disabled in case of the collateral defaulting like in case of refPerTok decreasing 
4) refresh is the only non-view function means here we check if the Collateral is good, not have any defaulting issuing,etc. and also change Status here 

tok == ref == target == UoA, eg USD, EURO, 
tok == ref == target != UoA, eg ETH, COMP, BTC , 
tok == ref != target != UoA, eg WETH, WBTC , tok = 



Collateral = cWBTC
tok = cWBTC, REF = WBTC, TARGET = BTC, UoA = USD 

Collateral = WETH,

tok = WETH, REF = WETH, TARGET = ETH, UoA = USD

----------------------


Full Example:
1) Let's say we want to store cWBTC (Compound WBTC) as collateral


What your main task is to get strictPrice() for refresh function, status and monitoring - and to find that you have to find exchange rate 

We can easily see : tok - cWBTC, ref - WBTC, target - BTC, UoA - USD

because  "cWBTC" you need to give Compound "WBTC", "WBTC" is a wrapped token of BTC, means we can take "BTC" as target, & UoA is currently USD 


cWBTC -> WBTC 
1 cWBTC -> WBTC


refPerTok()


About finding price - you can exchange "cWBTC" for "WBTC" at a variable rate which you get from a CToken underlyingExchangeRate function (this data is fetched in refPerTok()). 
For "WBTC" & "BTC" rate you can get it from the oracle(this is targetPerRef()), and similary get "BTC" & "USD" exchange rate using oracle(this is pricePerTarget()).

You can easily get exchange rate "cWBTC/USD" by multiplying these values

------

The above function and example listed above is just for cWBTC every plugin data is fetched using different ways


Read the collateral.md for more detailed information and also check the "Contract" folder for a full fledged example & "other-examples" folder to see more examples.

For creating plugins You need to implement - Collateral contract in AbstractCollateral (read the docs and examples you will understand)