# Maxx’s Lemonade Stand

A responsive website for Maxx’s lemonade stand at the DBE roundabout in Dorado Beach East, Puerto Rico.

## Website

[View the current site](https://maxxs-lemonade-dorado.maxxxbutler2000.chatgpt.site/). The Sites version currently requires the owner’s access.

The site includes the stand story, usual weekend hours, lemonade available at the stand, cookie and golf ball delivery, and email order requests. Titleist Pro V1 and Pro V1x are sold together in bags at $4 per ball. Customers can also request specific golf balls and discuss availability by email.

Contact and order email: **maxxxbutler2000@gmail.com**.

## Preview locally

This is a static website. It needs no build step or package installation.

From this folder, run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Files

- `index.html` — page content and order form
- `styles.css` — desktop and mobile styling
- `script.js` — navigation, product selection, and email draft creation
- `assets/lemonade-hero.jpg` — illustrative lemonade and cookie image

## Orders

The order form opens an email draft in the customer’s email app. Customers must send that email to request an order. There is also a copyable draft if no email app is configured. The website does not process payments or automatically confirm orders.

## Editing

Edit the HTML, CSS, and JavaScript directly. The GitHub copy and the Sites publication are separate; changes in this repository do not automatically update the Sites version.
