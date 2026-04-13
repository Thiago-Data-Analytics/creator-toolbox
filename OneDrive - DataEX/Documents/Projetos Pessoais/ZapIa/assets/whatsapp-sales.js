(function(){
  if(document.querySelector('meta[name="mbwa-disabled"]')) return;
  var ENTRY = 'https://api.mercabot.com.br/whatsapp/abrir';
  var lang = ((document.documentElement.getAttribute('lang') || 'pt').toLowerCase().indexOf('es') === 0) ? 'es' : 'pt';
  var path = (location.pathname || '/').toLowerCase();
  function enc(text){ return encodeURIComponent(text); }
  function wa(text){ return ENTRY + '?text=' + enc(text) + '&source=' + enc(contextLabel()) + '&lang=' + enc(lang); }
  function contextLabel(){
    if(path.indexOf('/cadastro') === 0) return 'checkout';
    if(path.indexOf('/demo') === 0) return lang === 'es' ? 'demo guiada' : 'demo guiada';
    if(path.indexOf('/painel-parceiro') === 0 || path.indexOf('/guia-parceiro') === 0) return lang === 'es' ? 'área partner' : 'área parceiro';
    if(path.indexOf('/chatbot-para-whatsapp') === 0) return lang === 'es' ? 'guía de chatbot' : 'guia de chatbot';
    if(path.indexOf('/automacao-whatsapp') === 0) return lang === 'es' ? 'guía de automatización' : 'guia de automação';
    if(path.indexOf('/whatsapp-business-api') === 0) return lang === 'es' ? 'guía de API' : 'guia de API';
    if(path.indexOf('/suporte') === 0 || path.indexOf('/soporte') === 0) return lang === 'es' ? 'central digital' : 'central digital';
    return lang === 'es' ? 'sitio principal' : 'site principal';
  }
  function copy(){
    if(lang === 'es'){
      return {
        eyebrow:'WhatsApp comercial',
        title:'Habla con MercaBot por WhatsApp',
        body:'Usa este canal para resolver dudas, entender cuál plan encaja mejor con tu operación y avanzar con una recomendación más clara para tu negocio.',
        launch:'Hablar por WhatsApp',
        close:'Cerrar',
        customTitle:'Escribe tu duda',
        customBody:'Si tu caso no encaja en los atajos, escribe la duda con tus palabras y di si hablas como cliente o socio.',
        roleLabel:'Perfil',
        roleClient:'Cliente',
        rolePartner:'Socio',
        questionLabel:'Tu duda',
        questionPlaceholder:'Ej.: Tengo una clínica, quiero usar WhatsApp oficial y entender cuál plan encaja mejor.',
        customError:'Escribe tu duda antes de abrir el WhatsApp.',
        customSubmit:'Enviar duda por WhatsApp',
        options:[
          { title:'Quiero sacar dudas del producto', desc:'Precios, activación, soporte, integración y cómo funciona.', text:'Hola, MercaBot. Quiero resolver dudas sobre el producto y entender cómo funciona en mi negocio. Estoy escribiendo desde ' + contextLabel() + '.' },
          { title:'Quiero saber qué plan me conviene', desc:'Starter, Pro o Socio según etapa, volumen y operación.', text:'Hola, MercaBot. Quiero que me indiquen qué plan encaja mejor con mi operación. Explíquenme cómo decidir entre Starter, Pro y Socio. Estoy escribiendo desde ' + contextLabel() + '.' },
          { title:'Quiero recibir catálogo y precios', desc:'Recibir el catálogo comercial y entender el valor de cada plan.', text:'Hola, MercaBot. Quiero recibir el catálogo comercial con Starter, Pro y Socio y entender qué cambia entre los planes.' },
          { title:'Quiero revender o usar marca blanca', desc:'Para agencias, consultores y operación multi-cliente.', text:'Hola, MercaBot. Quiero entender el plan Socio, la reventa y el uso white-label para operar con marca propia.' }
        ]
      };
    }
    return {
      eyebrow:'WhatsApp comercial',
      title:'Tire dúvidas com a MercaBot no WhatsApp',
      body:'Use este canal para entender o produto, descobrir qual plano faz mais sentido para o seu momento e avançar com uma recomendação mais clara para a sua operação.',
      launch:'Tirar dúvidas',
      close:'Fechar',
      customTitle:'Escreva sua dúvida',
      customBody:'Se o seu caso não se encaixa nos atalhos, descreva a dúvida com suas palavras e diga se você fala como cliente ou parceiro.',
      roleLabel:'Perfil',
      roleClient:'Cliente',
      rolePartner:'Parceiro',
      questionLabel:'Sua dúvida',
      questionPlaceholder:'Ex.: Tenho uma clínica, quero usar WhatsApp oficial e entender qual plano faz mais sentido.',
      customError:'Escreva sua dúvida antes de abrir o WhatsApp.',
      customSubmit:'Enviar dúvida por WhatsApp',
      options:[
        { title:'Quero tirar dúvidas sobre o produto', desc:'Preços, ativação, suporte, integrações e como funciona na prática.', text:'Olá, MercaBot. Quero tirar dúvidas sobre o produto e entender como ele funciona no meu negócio. Estou falando a partir de ' + contextLabel() + '.' },
        { title:'Quero saber qual plano combina comigo', desc:'Starter, Pro ou Parceiro de acordo com etapa, volume e operação.', text:'Olá, MercaBot. Quero que vocês me indiquem o melhor plano para o meu momento. Me expliquem como decidir entre Starter, Pro e Parceiro. Estou falando a partir de ' + contextLabel() + '.' },
        { title:'Quero receber catálogo e preços', desc:'Catálogo comercial com os pacotes e o valor percebido de cada um.', text:'Olá, MercaBot. Quero receber o catálogo comercial com Starter, Pro e Parceiro e entender o que muda entre os planos.' },
        { title:'Quero revender ou usar marca própria', desc:'Para agências, consultores, implantadores e operação multi-cliente.', text:'Olá, MercaBot. Quero entender o plano Parceiro, revenda e uso white-label para operar com marca própria.' }
      ]
    };
  }
  function build(){
    var t = copy();
    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'mbwa-launcher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'mbwa-drawer');
    launcher.innerHTML = '<span class="mbwa-icon" aria-hidden="true">💬</span><span class="mbwa-label">' + t.launch + '</span>';
    var drawer = document.createElement('aside');
    drawer.className = 'mbwa-drawer';
    drawer.id = 'mbwa-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', t.title);
    var grid = t.options.map(function(opt){
      return '<a class="mbwa-option" href="' + wa(opt.text) + '" target="_blank" rel="noopener"><strong>' + opt.title + '</strong><span>' + opt.desc + '</span></a>';
    }).join('');
    drawer.innerHTML = '<div class="mbwa-eyebrow">WhatsApp</div><h2 class="mbwa-title">' + t.title + '</h2><p class="mbwa-copy">' + t.body + '</p><div class="mbwa-grid">' + grid + '</div><div class="mbwa-custom"><h3>' + t.customTitle + '</h3><p>' + t.customBody + '</p><div class="mbwa-field"><label for="mbwa-role">' + t.roleLabel + '</label><select id="mbwa-role" class="mbwa-select"><option value="' + t.roleClient.toLowerCase() + '">' + t.roleClient + '</option><option value="' + t.rolePartner.toLowerCase() + '">' + t.rolePartner + '</option></select></div><div class="mbwa-field"><label for="mbwa-question">' + t.questionLabel + '</label><textarea id="mbwa-question" class="mbwa-textarea" placeholder="' + t.questionPlaceholder + '"></textarea><div class="mbwa-error" id="mbwa-question-error" aria-live="polite"></div></div><button type="button" class="mbwa-submit">' + t.customSubmit + '</button></div><div class="mbwa-meta"><button type="button" class="mbwa-close">' + t.close + '</button></div>';
    function setCustomError(message){
      var error = drawer.querySelector('#mbwa-question-error');
      var question = drawer.querySelector('#mbwa-question');
      var field = question ? question.closest('.mbwa-field') : null;
      if(error) error.textContent = message || '';
      if(field) field.classList.toggle('has-error', !!message);
    }
    function sendCustomQuestion(){
      var role = drawer.querySelector('#mbwa-role');
      var question = drawer.querySelector('#mbwa-question');
      var roleValue = role ? String(role.value || '').trim() : '';
      var questionValue = question ? String(question.value || '').trim() : '';
      if(!questionValue){
        setCustomError(t.customError);
        if(question) question.focus();
        return;
      }
      setCustomError('');
      var intro = lang === 'es'
        ? 'Hola, MercaBot. Tengo una duda y hablo como ' + roleValue + '.'
        : 'Olá, MercaBot. Tenho uma dúvida e falo como ' + roleValue + '.';
      var place = lang === 'es'
        ? 'Estoy escribiendo desde ' + contextLabel() + '.'
        : 'Estou falando a partir de ' + contextLabel() + '.';
      window.open(wa(intro + ' ' + questionValue + ' ' + place), '_blank', 'noopener');
    }
    function closeDrawer(){ drawer.hidden = true; launcher.setAttribute('aria-expanded', 'false'); }
    function openDrawer(){ drawer.hidden = false; launcher.setAttribute('aria-expanded', 'true'); }
    launcher.addEventListener('click', function(){ drawer.hidden ? openDrawer() : closeDrawer(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeDrawer(); });
    document.addEventListener('click', function(e){ if(drawer.hidden) return; if(drawer.contains(e.target) || launcher.contains(e.target)) return; closeDrawer(); });
    drawer.querySelector('.mbwa-close').addEventListener('click', closeDrawer);
    drawer.querySelector('.mbwa-submit').addEventListener('click', sendCustomQuestion);
    drawer.querySelector('#mbwa-question').addEventListener('input', function(){
      if(String(this.value || '').trim()) setCustomError('');
    });
    document.body.appendChild(drawer);
    document.body.appendChild(launcher);
  }
  if(document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
