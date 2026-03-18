script to update the translation in such cases of sentence format changes as a bulk reading from an excel sheet.
[ xlsx to json ]
replaces existing keys with the text from excel, adds missing keys with text and keeps

NOTE : 
uncomment the relevant full path string maker part when using for FE or BE inside updateJsonFile().
Input Excel file should have at least 3 columns: File/Directory name, i18n Key, actual translation text.
where file name rows merged along the column for several i18 keys are handled as individual entries for the same .json translation file.

needs improvement : should watch out or fix instances where keyPart1.keyPart2 = "something", as it automatically replaced with keyPart1 : {keyPart2:"something"} structure
