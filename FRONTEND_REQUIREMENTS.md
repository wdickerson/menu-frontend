

## Overview (Version 0)

This repo will hold a React app that helps blind users read restaurant menus through an intuitive slide gesture. It is hosted online, and primarily accessed through a mobile browser.

We will build the web app incrementally. First build a simple React app that displays minimal info on a static screen. There should be no scrolling, as we are going to use swipe gestures very specifically.

## Version 1

The app will be responsible for accepting a photo of a menu, and turning that into structured syntax which can be read to the user. First, simply create a structured JSON representation of the example menu provided in the "assets" directory. We will add runtime menu parsing in a later version, and we will add menu speech in a later version.

## Version 2

We need to implement speech, in order to communicate the menu to blind users. For an initial approach, add two sets of arrow buttons to the static webpage. One set of arrow buttons cycles through the menu sections. The other set cycles through items in the current section. Each button click results in the next item being read aloud. Do not focus too much on the UI of the buttons, as we will replace them later with swipe gestures; the goal of this iteration is to implement speech for the menu.

## Version 3

Now, we are going to work on the touch interface. This site is intended to be used on a smartphone. The controls are this:

- 1 Finger Swipe
-- Down towards bottom of screen progresses forward through Sections
-- Up towards top of screen progresses backwards through Sections

- 1 Finger Tap
-- Re-reads the current Section

-2 Finger Swipe
--Down towards bottom of screen progresses forward through Items within the current section
--Up towards top of screen progresses backwards through Items within the current section

- 2 Finger tap
-- Re-reads the current item

You can remove the buttons now, as we are focusing on the mobile experience.

I have the app running on a smartphone, loading from localhost. I can test for the "feel" of it as you go.

## Version 4

Add some audible indications.

When reaching the end of a collection (ie, the end of the list of sections, or the end of the list of items in a section), do not wrap around and play the first section/item again. Instead, play an audible "thump" sound. Use the Web Audio API to accomplish the "thump". It should be like a low beep, which people will recognize as reaching the end.

If a user is already at the last item and tries to proceed with a tough gesture, the thump should sound.

## Version 5

Just some housekeeping. 

The text on the screen jumps around. I don't want anything jumping around. Simplify things. Remove "Current item". Show the text, but have it confined to a box that can't grow, so that nothing appears to "jump" as I swipe through items.

Also, the Rough and Tumble menu is actually two pages. I now placed two images in a folder. Re-create the JSON file by looking at the images, so the whole menu is available. Use your judgement about what order the sections should be in.

## Version 6

We will not implement a second method of navigating through the menu. The method will be determined with a query parameter called "mode".

There should not be any way in the UI to change modes. Only manually changing the URL in the browser should change the mode.

If "?mode=scroll", that is the version we have built already.

If "?mode=flick", We will implement this new version:

-Flick up on the screen progresses forward through the Section list. Flick down on the screen progresses backwards through the Section list.

-Flick left on the screen progresses forward through Items in the current section. Flick right on the screen progresses backwards through items in the current section.

-All flicks must be with one finger. Two-finger flicks do nothing.

-Tap once with one finger repeats the last utterance, whether it is a Section or an Item.

-Behavior of the "thumps" remain the same. End of list = thump. Try to proceed past the end of the list = thump. Go back once you hear the thump = hear the very last or very first list item.

## Version 7

We need to make the reading speed adjustable.

Possible speeds are 1x, 1.5x, 2x, 2.5x, 3x, 3.5x.

When a user "double taps" (with a single finger), the app should say "Speed [current speed]". If they double tap again before making any other touch gesture, cycle to the next speed and read "Speed [speed]" again. 

Display the speed in small print under the restaurant name, but do not make it adjustable in any other way than the "double tap" behavior described above.

## Version 8

Make "flick" the default mode. If no "mode" query param is present, use flick. If mode is anything but "swipe", use flick.

## Version 9

We want to introduce a restaurant selection mode. Users reach it by holding one finger on the screen for 3 seconds.

Include a "progress bar" at the bottom of the screen to show the "hold for select mode" 3 second wait.

Once in this mode, show a simple page with two restaurants:
Rough & Tumble
Twilight

Each restaurant name is a button, which loads that menu into the app. Once it is selected, return to the currently established behavior with the correct menu.

Maintain a single page app. Do not include the restaurant name in the URL.

This is the only page which is geared towards sighted users. In future revisions, we will make it more user friendly for low-vision users.

I have added images of Twilight's menu. You will need to examine the images and create the required JSON for Twilight's menu.

## Version 10

Use the browser's localStorage to maintain the current restaurant selection and speech rate even on a page reload

## Version 11

Remove the "scroll" mode altogether. Remove all notions of "mode". We are proceeding with only "flick" control.

Remove the "hold for select" logic. Instead, add a full-width button at the top of the main page labeled "Load Menu". This button should open the menu selection page.

## Version 12

This version makes the app more accessible for users who use screen readers.

Below the "Load Menu" button, add a "Enter Quick Nav Mode" button.

Below the "Enter Quick Nav Mode" button, if a menu is loaded, display it in a simple format that is navigable by screen readers. It should mirror the simple Section -> List Item structure that we have been using. On this main page, the flick gestures do no function. Scrolling is now allowed on this page. Remove all other content on this page that is not specified (ie, the page title, section/item numbers)

When the "Enter Quick Nav Mode" button is clicked, enter a new screen. This screen is now where the flick gestures are handled. The top portion of the screen is a div for handling the flick gestures. On the bottom of the screen, a full-width button says "Exit Quick Nav Mode".

## Version 13

Do not show the restaurant name or menu item on the Quick Nav screen. Instead, have the div that handles the flick gestures show static text describing how to use the flick gestures:

"This is the Quick Nav page. 
Turn off screen readers to enable quick nav gestures.
Flick up/down to navigate menu sections.
Flick left/right to navigate items.
Double tap to change reading speed."

## Version 14

Rename the "Load Menu" button to "Reload a Recent Menu".

Above the "Reload a Recent Menu" button, add a "Capture a New Menu" button.

When the user clicks "Capture a New Menu", a new page opens that is dedicated to capturing one or more images of a menu and POSTing them to the API. Here is the user experience:

Tapping "Capture a New Menu" immediately opens a full-screen camera view. Two buttons are present at the bottom of the screen "Capture an image" and "Load this menu"

"Capture an image" captures a single image, and a small preview of that image appears with a little "x" (remove) button at the top right.

"Load this menu" posts the captured images to the API.

A smaller "close" button at the top right closes the camera view without posting.

Pinch-to-zoom works on the camera view screen page.

getUserMedia() is used so as to implement a custom UI for the camera view page.

When the POST returns, the menu in the response is loaded into the app. This menu is saved to localStorage and can be re-loaded via the "Reload a Recent Menu" page. The two hardcoded are still on that page for now, as well. 

For now, the API endpoint can be hardocded into the frontend code: https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus

Ensure images that are posted do not exceen 250kb each

## Version 15

Add a flashlight toggle to the top left of the image capture screen. Since we don't have native flash via getUserMedia, this will have to do.

Once a user taps "Load this Menu", return to the main screen and display a loading screen while the menu is processing. The API call may take 20+ seconds, so it is important to let the user know that things are processing.

## Version 16

Replace the getUserMedia version of the image capture flow with one that uses the phone's native camera. The getUserMedia version is unable to capture distant menus clearly enough.

Keep the UX flow as similar as possible.

As soon as the user taps "Capture a New Menu", the phone's native camera view should appear. When they capture the first image, they are returned to a preview screen that shows the captured images as small icons, with an "x" in the top right corner to remove. Tapping the icon expands the image to full screen so the user can see if the text is legible (a "Close" button is at the top right).

From the preview screen, the user has two options: "Add another image" or "Done". Tapping "Done" sends the POST and proceeds with the existing UX flow.

Send images at a maximum of 350kb each. Also, ensure images are at no higher of a resolution than 1024 pixels in either dimension, maintaining the original aspect ratio.

