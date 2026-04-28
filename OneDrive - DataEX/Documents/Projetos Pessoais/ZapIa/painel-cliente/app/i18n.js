/**
 * MercaBot painel-cliente — i18n (PT/ES/EN)
 *
 * Carregado ANTES do app.js para aplicar traduções na primeira renderização
 * sem flash de português.
 *
 * Detecção de idioma (em ordem de prioridade):
 *  1. ?lang=pt|es|en na URL
 *  2. localStorage.mb_panel_lang
 *  3. navigator.language → mapeia pt-* → pt, es-* → es, en-* → en
 *  4. fallback 'pt'
 *
 * Uso no HTML:
 *   <h1 data-i18n="auth.title">Acesse sua operação</h1>            (textContent)
 *   <span data-i18n-html="welcome.step1">...</span>                 (innerHTML)
 *   <input data-i18n-attr="placeholder=auth.emailPh">               (atributos)
 *
 * Convenção de chaves: dot.notation, ex: auth.title, welcome.step2
 */
(function () {
  'use strict';

  // ── DICIONÁRIOS ───────────────────────────────────────────────────────────
  var PT = {
    // Auth shell
    'auth.title':            'Acesse sua operação',
    'auth.intro':            'Use o e-mail da sua conta MercaBot. Vamos enviar um link seguro para você entrar e retomar de onde parou.',
    'auth.note':             'Este acesso usa um link seguro por e-mail. O painel só libera a conta após a autenticação.',
    'auth.emailLabel':       'E-mail',
    'auth.emailPlaceholder': 'nome@empresa.com',
    'auth.sendLink':         'Receber link de acesso',
    'auth.continueSession':  'Continuar no painel',
    'auth.useOtherEmail':    'Usar outro e-mail',

    // Welcome modal
    'welcome.title':         'Conta criada com sucesso!',
    'welcome.body':          'Agora você tem tudo que precisa para colocar a IA respondendo seus clientes no WhatsApp. São só 3 passos — leva menos de 15 minutos.',
    'welcome.step1.html':    '<strong>Salvar o número</strong> oficial da empresa no WhatsApp',
    'welcome.step2.html':    'Dizer como o bot deve <strong style="color:#eaf2eb">atender seus clientes</strong>',
    'welcome.step3.html':    'Fazer o <strong style="color:#eaf2eb">primeiro teste</strong> — e o bot já estará respondendo',
    'welcome.start':         'Começar agora →',
    'welcome.skip':          'Ver o painel primeiro',

    // Celebration overlay
    'celebration.title':     'Bot ativo!',
    'celebration.body':      'Parabéns! Seu bot já está configurado e pronto para responder clientes no WhatsApp. Agora é só testar e divulgar.',
    'celebration.test':      'Fazer teste agora →',
    'celebration.close':     'Fechar',

    // Topbar
    'topbar.logout':         'Sair',
    'topbar.alerts':         'Alertas',
    'topbar.alertsClear':    'Limpar',
    'topbar.alertsEmpty':    'Nenhum alerta no momento',
    'topbar.alertsGoto':     'Ir para Inbox →',
    'topbar.greeting':       'Olá!',
    'topbar.planBadge':      'Plano',

    // Tabs
    'tab.dashboard':         '📊 Painel',
    'tab.inbox':             '💬 Inbox',
    'tab.contacts':          '👥 Contatos',
    'tab.plan':              '💳 Plano',
    'tab.analytics':         '📈 Análise',
    'tab.support':           'Suporte',
    'tab.settings':          '⚙️ Config.',

    // Quickstart
    'qs.eyebrow':            'Ativação guiada da conta',
    'qs.title':              'Seu próximo passo está aqui',
    'qs.intro':              'Você só precisa seguir esta ordem: salvar o WhatsApp da empresa, preencher a operação e fazer o primeiro teste. A MercaBot conduz o restante da ativação.',
    'qs.step.label':         'Etapa',
    'qs.state.now':          'Agora',
    'qs.state.next':         'Depois',
    'qs.state.done':         'Concluído',
    'qs.guide.prefix.html':  '<strong>Concluído quando:</strong>',
    'qs.s1.title':           'Salvar o WhatsApp da empresa',
    'qs.s1.copy':            'Informe o número principal da empresa. Depois disso, a MercaBot segue com a ativação e te chama só quando uma autorização realmente for necessária.',
    'qs.s1.guide':           'o WhatsApp principal já foi salvo e a ativação pode seguir.',
    'qs.s2.title':           'Configurar como o bot deve atender',
    'qs.s2.copy':             'Diga ao bot como agir, o que sempre fazer e o que evitar. Salve a primeira frase pronta para deixar o atendimento mais natural.',
    'qs.s2.guide':           'a instrução principal e a primeira frase pronta já estão salvas.',
    'qs.s3.title':           'Fazer o primeiro teste',
    'qs.s3.copy':            'Mande uma mensagem teste para o seu próprio WhatsApp e veja a IA respondendo. Quando funcionar, divulgue para clientes.',
    'qs.s3.guide':           'um teste real foi feito e a IA respondeu como esperado.',
    'qs.state.connected':    'Conectado ✓',
    'qs.state.saved':        'Salvo · Meta pendente',
    'qs.state.ready':        'Pronto',
    'qs.action.s1.do':       'Informar WhatsApp',
    'qs.action.s1.review':   'Revisar WhatsApp',
    'qs.action.s1.savedReview':'Revisar número salvo',
    'qs.action.s2.do':       'Preencher operação',
    'qs.action.s2.review':   'Revisar operação',
    'qs.action.s3':          'Fazer primeiro teste',
    'qs.progress.step1':     'Etapa 1 de 3: vamos salvar o WhatsApp da empresa.',
    'qs.progress.step1of3':  '1 de 3 etapas concluídas. Etapa 2: configure a operação.',
    'qs.progress.step1pending':'1 de 3 — número salvo (o bot ainda não responde até a Meta ativar). Etapa 2: configure a operação.',
    'qs.progress.step2of3':  '2 de 3 etapas concluídas. Etapa 3: fazer o primeiro teste.',
    'qs.progress.step3of3':  '3 de 3 — canal conectado e IA no ar. Faça o primeiro teste!',
    'qs.progress.step3pending':'3 de 3 — número salvo, ativação Meta em andamento com a equipe MercaBot.',
    'inactivity.next.s1':    'Próximo: salvar o número oficial.',
    'inactivity.next.s2':    'Próximo: preencher a base da operação.',

    // Banners
    'banner.offline':        'Você está offline — verifique sua conexão para sincronizar as últimas mensagens.',
    'banner.inactivity.title':'Sua configuração está incompleta',
    'banner.inactivity.body': '— falta pouco para o bot começar a responder.',
    'banner.inactivity.cta':  'Continuar agora',
    'banner.dunning.cta':    'Atualizar cartão →',
    'banner.planLimit.body.html': '<strong>Você já usou <span id="planLimitPct">80%</span> das conversas do plano este mês.</strong> <span style="color:rgba(252,211,77,.75)">Para não ter o atendimento interrompido, considere fazer upgrade antes de chegar ao limite.</span>',
    'banner.planLimit.cta':  'Ver planos →',

    // Activation checklist bar
    'activation.label':      'Ativação',
    'activation.step1':      '📱 Número',
    'activation.step2':      '⚙️ Operação',
    'activation.step3':      '✅ Teste',

    // Breadcrumb / Crumbs
    'crumb.dashboard':       'Painel',

    // Common
    'common.close':          'Fechar',
    'common.back':           'Voltar',
    'common.next':           'Próximo →',
    'common.save':           'Salvar',
    'common.cancel':         'Cancelar',
    'common.loading':        'Carregando…',

    // Setup banner (canal não conectado)
    'setup.pill':            'Próxima ação recomendada',
    'setup.title':           'Sua ativação ainda não foi concluída',
    'setup.copy':            'Informe o WhatsApp principal da empresa, deixe a MercaBot seguir com a ativação e depois revise a operação com calma.',
    'setup.checklist1':      'Você informa só o WhatsApp principal da empresa.',
    'setup.checklist2':      'A MercaBot conduz a ativação e avisa quando algo precisar da sua aprovação.',
    'setup.checklist3':      'Depois disso, basta preencher a operação e validar o primeiro teste.',
    'setup.action':          'Informar WhatsApp →',
    'setup.secondary':       'Entender a ativação',

    // Plan tab
    'plan.your':             'Seu plano',
    'plan.change':           'Alterar plano',
    'plan.payment':          'Pagamento e assinatura',
    'plan.next':             'Escolha o próximo passo',
    'plan.nextCopy':         'Abra o portal da conta para gerenciar pagamento ou cancelar o plano. Se o portal ainda não estiver disponível, a MercaBot redireciona você para o suporte correto.',
    'plan.manage':           'Gerenciar pagamento',
    'plan.cancel':           'Cancelar plano',

    // Support tab
    'support.title':         'Ajuda quando precisar',
    'support.lead':          'Vá direto ao que precisa',
    'support.leadCopy':      'Escolha abaixo o caminho mais simples para seguir com ativação, cobrança, primeiro teste ou dúvidas da conta.',
    'support.guides':        'Ver guias rápidos',
    'support.guidesCopy':    'Abra guias curtos para ativação, cobrança, primeiro teste e ajustes do atendimento.',
    'support.center':        'Resolver na central digital',
    'support.centerCopy':    'A central digital abre o fluxo correto para ativação, cobrança, ajustes ou dúvidas da conta.',
    'support.meta':          'Revisar passo a passo da Meta',
    'support.metaCopy':      'Abra o guia técnico só se você quiser acompanhar a integração em detalhe.',
    'support.ticket':        'Descrever o que precisa',
    'support.ticketCopy':    'Abra a central digital com assunto e descrição já preenchidos.',
    'support.demo':          'Ver exemplo de atendimento',
    'support.demoCopy':      'Abra uma demonstração rápida para entender como o atendimento deve ficar depois da ativação.',
    'support.tour':          'Refazer o tour do painel',
    'support.tourCopy':      'Replay do guia interativo passo a passo — útil para redescobrir recursos que você ainda não usou.',
    'support.connections':   'Conexões da sua conta',
    'support.aiPremium':     'IA premium do MercaBot',
    'support.aiCopy':        'A IA premium já faz parte do serviço. Seu foco aqui é só conectar o WhatsApp da empresa e revisar o atendimento.',
    'support.aiInline':      'IA premium inclusa · pronta no backend',
    'support.aiHow':         'Como funciona',
    'support.officialNum':   'Número oficial da sua empresa',
    'support.officialCopy':  'Esse é o número que seus clientes já conhecem. O MercaBot usa esse número como base do atendimento automatizado e da ativação assistida.',
    'support.notInformed':   'Ainda não informado',
    'support.channelPrep':   'Canal em preparação',
    'support.channelHint':   'Informe o WhatsApp principal da empresa para começar. A MercaBot conduz a ativação e mostra só o que realmente precisa da sua aprovação.',
    'support.informWA':      'Informar WhatsApp',

    // Settings tab
    'settings.title':        'Configurações',
    'settings.notifs':       '🔔 Notificações',
    'settings.notifDesktop': 'Notificações desktop',
    'settings.notifDesktopHint':'Alerta quando uma conversa precisa de atendimento humano',
    'settings.notifEmail':   'Notificações por e-mail',
    'settings.notifEmailHint':'Resumo diário de conversas e leads',
    'settings.hours':        '🕐 Horário de atendimento',
    'settings.hoursCopy':    'O bot informa automaticamente quando estiver fora do horário definido aqui.',
    'settings.hoursStart':   'Início',
    'settings.hoursEnd':     'Fim',
    'settings.hoursSave':    'Salvar horário',
    'settings.identity':     '🤖 Identidade do bot',
    'settings.botName':      'Nome do atendente virtual',
    'settings.botGreeting':  'Saudação inicial',
    'settings.identitySave': 'Salvar identidade',
    'settings.tour':         '🗺️ Tour e atalhos',
    'settings.tourCopy':     'Reveja o tour de boas-vindas a qualquer momento ou consulte os atalhos de teclado disponíveis.',
    'settings.tourReplay':   '🗺️ Refazer tour',
    'settings.shortcuts':    '⌨️ Ver atalhos',
    'settings.day.mon':      'Seg', 'settings.day.tue': 'Ter', 'settings.day.wed': 'Qua',
    'settings.day.thu':      'Qui', 'settings.day.fri': 'Sex', 'settings.day.sat': 'Sáb', 'settings.day.sun': 'Dom',

    // Modais comuns
    'modal.upgrade.title':   'Escolher novo plano',
    'modal.upgrade.sub':     'Ao confirmar, você segue para a contratação com o plano já selecionado. Se quiser revisar cobrança antes, use a central digital da conta.',
    'modal.upgrade.confirm': 'Confirmar mudança',
    'modal.request.title':   'Abrir ajuda com o contexto já pronto',
    'modal.request.sub':     'Explique em poucas linhas o que você precisa resolver. A MercaBot prepara o assunto e leva você direto para o fluxo certo de suporte.',
    'modal.request.subjectLabel':'Assunto',
    'modal.request.subjectPh':'Ex: Bot não está respondendo',
    'modal.request.detailLabel':'Descrição',
    'modal.request.detailPh':'Descreva o que está acontecendo e o que já tentou...',
    'modal.request.continue':'Continuar com ajuda guiada',
    'modal.channel.title':   'Cadastre o WhatsApp principal da sua empresa',
    'modal.channel.sub':     'Nesta etapa, você só precisa informar o número que sua empresa vai usar no atendimento. A MercaBot cuida da parte técnica e só pede apoio quando isso for realmente necessário.',
    'modal.channel.numLabel':'Número oficial da empresa',
    'modal.channel.numHint': 'Digite o número que seus clientes já usam para falar com você — vamos formatar automaticamente.',
    'modal.channel.metaConnect':'Conecte sua conta da Meta',
    'modal.channel.metaConnectCopy':'Clique no botão — a MercaBot busca o número e o token automaticamente. Leva menos de 1 minuto.',
    'modal.channel.metaWarn':'⚠️ Atenção antes de conectar: ao vincular, o WhatsApp neste número operará exclusivamente via API — o aplicativo do celular deixará de receber mensagens nesse número. Use um número dedicado à empresa, não pessoal.',
    'modal.channel.metaBtn': 'Conectar com WhatsApp Business',
    'modal.channel.manual':  'Prefiro inserir os dados manualmente'
  };

  var ES = {
    'auth.title':            'Accede a tu operación',
    'auth.intro':             'Usa el correo de tu cuenta MercaBot. Te enviaremos un enlace seguro para entrar y retomar donde lo dejaste.',
    'auth.note':              'Este acceso usa un enlace seguro por correo. El panel solo se libera tras la autenticación.',
    'auth.emailLabel':       'Correo',
    'auth.emailPlaceholder': 'tu@empresa.com',
    'auth.sendLink':         'Recibir enlace de acceso',
    'auth.continueSession':  'Continuar en el panel',
    'auth.useOtherEmail':    'Usar otro correo',

    'welcome.title':         '¡Cuenta creada con éxito!',
    'welcome.body':          'Ya tienes todo lo necesario para que la IA responda a tus clientes en WhatsApp. Son 3 pasos — toma menos de 15 minutos.',
    'welcome.step1.html':    '<strong>Guardar el número</strong> oficial de la empresa en WhatsApp',
    'welcome.step2.html':    'Decir cómo el bot debe <strong style="color:#eaf2eb">atender a tus clientes</strong>',
    'welcome.step3.html':    'Hacer la <strong style="color:#eaf2eb">primera prueba</strong> — y el bot estará respondiendo',
    'welcome.start':         'Comenzar ahora →',
    'welcome.skip':          'Ver el panel primero',

    'celebration.title':     '¡Bot activo!',
    'celebration.body':      '¡Felicitaciones! Tu bot ya está configurado y listo para responder clientes en WhatsApp. Ahora solo prueba y publica.',
    'celebration.test':      'Hacer prueba ahora →',
    'celebration.close':     'Cerrar',

    'topbar.logout':         'Salir',
    'topbar.alerts':         'Alertas',
    'topbar.alertsClear':    'Limpiar',
    'topbar.alertsEmpty':    'Sin alertas por ahora',
    'topbar.alertsGoto':     'Ir al Inbox →',
    'topbar.greeting':       '¡Hola!',
    'topbar.planBadge':      'Plan',

    'tab.dashboard':         '📊 Panel',
    'tab.inbox':             '💬 Inbox',
    'tab.contacts':          '👥 Contactos',
    'tab.plan':              '💳 Plan',
    'tab.analytics':         '📈 Análisis',
    'tab.support':           'Soporte',
    'tab.settings':          '⚙️ Config.',

    'qs.eyebrow':            'Activación guiada de la cuenta',
    'qs.title':              'Tu siguiente paso está aquí',
    'qs.intro':              'Solo sigue este orden: guardar el WhatsApp, completar la operación y hacer la primera prueba. MercaBot conduce el resto de la activación.',
    'qs.step.label':         'Etapa',
    'qs.state.now':          'Ahora',
    'qs.state.next':         'Después',
    'qs.state.done':         'Completado',
    'qs.guide.prefix.html':  '<strong>Completado cuando:</strong>',
    'qs.s1.title':           'Guardar el WhatsApp de la empresa',
    'qs.s1.copy':            'Ingresa el número principal de la empresa. Después de eso, MercaBot continúa la activación y solo te llama cuando realmente se necesite una autorización.',
    'qs.s1.guide':           'el WhatsApp principal ya fue guardado y la activación puede seguir.',
    'qs.s2.title':           'Configurar cómo el bot debe atender',
    'qs.s2.copy':            'Dile al bot cómo actuar, qué hacer siempre y qué evitar. Guarda la primera frase lista para que el atendimiento sea más natural.',
    'qs.s2.guide':           'la instrucción principal y la primera frase lista ya están guardadas.',
    'qs.s3.title':           'Hacer la primera prueba',
    'qs.s3.copy':            'Envía un mensaje de prueba a tu propio WhatsApp y mira a la IA respondiendo. Cuando funcione, publícalo para clientes.',
    'qs.s3.guide':           'una prueba real fue hecha y la IA respondió como se esperaba.',
    'qs.state.connected':    'Conectado ✓',
    'qs.state.saved':        'Guardado · Meta pendiente',
    'qs.state.ready':        'Listo',
    'qs.action.s1.do':       'Ingresar WhatsApp',
    'qs.action.s1.review':   'Revisar WhatsApp',
    'qs.action.s1.savedReview':'Revisar número guardado',
    'qs.action.s2.do':       'Completar operación',
    'qs.action.s2.review':   'Revisar operación',
    'qs.action.s3':          'Hacer primera prueba',
    'qs.progress.step1':     'Etapa 1 de 3: vamos a guardar el WhatsApp de la empresa.',
    'qs.progress.step1of3':  '1 de 3 etapas completadas. Etapa 2: configura la operación.',
    'qs.progress.step1pending':'1 de 3 — número guardado (el bot aún no responde hasta que Meta active). Etapa 2: configura la operación.',
    'qs.progress.step2of3':  '2 de 3 etapas completadas. Etapa 3: hacer la primera prueba.',
    'qs.progress.step3of3':  '3 de 3 — canal conectado e IA en línea. ¡Haz la primera prueba!',
    'qs.progress.step3pending':'3 de 3 — número guardado, activación Meta en curso con el equipo MercaBot.',
    'inactivity.next.s1':    'Siguiente: guardar el número oficial.',
    'inactivity.next.s2':    'Siguiente: completar la base de la operación.',

    'banner.offline':        'Estás sin conexión — verifica tu internet para sincronizar los últimos mensajes.',
    'banner.inactivity.title':'Tu configuración está incompleta',
    'banner.inactivity.body': '— falta poco para que el bot empiece a responder.',
    'banner.inactivity.cta':  'Continuar ahora',
    'banner.dunning.cta':    'Actualizar tarjeta →',
    'banner.planLimit.body.html': '<strong>Ya usaste el <span id="planLimitPct">80%</span> de las conversaciones del plan este mes.</strong> <span style="color:rgba(252,211,77,.75)">Para no interrumpir el atendimiento, considera hacer upgrade antes de llegar al límite.</span>',
    'banner.planLimit.cta':  'Ver planes →',

    'activation.label':      'Activación',
    'activation.step1':      '📱 Número',
    'activation.step2':      '⚙️ Operación',
    'activation.step3':      '✅ Prueba',

    'crumb.dashboard':       'Panel',

    'common.close':          'Cerrar',
    'common.back':           'Volver',
    'common.next':           'Siguiente →',
    'common.save':           'Guardar',
    'common.cancel':         'Cancelar',
    'common.loading':        'Cargando…',

    'setup.pill':            'Próxima acción recomendada',
    'setup.title':           'Tu activación aún no está completa',
    'setup.copy':            'Ingresa el WhatsApp principal de la empresa, deja que MercaBot continúe la activación y luego revisa la operación con calma.',
    'setup.checklist1':      'Solo informas el WhatsApp principal de la empresa.',
    'setup.checklist2':      'MercaBot conduce la activación y avisa cuando algo necesite tu aprobación.',
    'setup.checklist3':      'Después de eso, solo completa la operación y valida la primera prueba.',
    'setup.action':          'Ingresar WhatsApp →',
    'setup.secondary':       'Entender la activación',

    'plan.your':             'Tu plan',
    'plan.change':           'Cambiar plan',
    'plan.payment':          'Pago y suscripción',
    'plan.next':             'Elige el siguiente paso',
    'plan.nextCopy':         'Abre el portal de la cuenta para gestionar el pago o cancelar el plan. Si el portal aún no está disponible, MercaBot te redirige al soporte correcto.',
    'plan.manage':           'Gestionar pago',
    'plan.cancel':           'Cancelar plan',

    'support.title':         'Ayuda cuando la necesites',
    'support.lead':          'Ve directo a lo que necesitas',
    'support.leadCopy':      'Elige abajo el camino más simple para seguir con activación, cobranza, primera prueba o dudas de la cuenta.',
    'support.guides':        'Ver guías rápidas',
    'support.guidesCopy':    'Abre guías cortas para activación, cobranza, primera prueba y ajustes del atendimiento.',
    'support.center':        'Resolver en el centro digital',
    'support.centerCopy':    'El centro digital abre el flujo correcto para activación, cobranza, ajustes o dudas de la cuenta.',
    'support.meta':          'Revisar paso a paso de Meta',
    'support.metaCopy':      'Abre la guía técnica solo si quieres acompañar la integración en detalle.',
    'support.ticket':        'Describir lo que necesitas',
    'support.ticketCopy':    'Abre el centro digital con asunto y descripción ya completados.',
    'support.demo':          'Ver ejemplo de atendimiento',
    'support.demoCopy':      'Abre una demostración rápida para entender cómo debe quedar el atendimiento después de la activación.',
    'support.tour':          'Repetir el tour del panel',
    'support.tourCopy':      'Replay de la guía interactiva paso a paso — útil para redescubrir recursos que aún no usaste.',
    'support.connections':   'Conexiones de tu cuenta',
    'support.aiPremium':     'IA premium de MercaBot',
    'support.aiCopy':        'La IA premium ya forma parte del servicio. Tu foco aquí es solo conectar el WhatsApp de la empresa y revisar el atendimiento.',
    'support.aiInline':      'IA premium incluida · lista en el backend',
    'support.aiHow':         'Cómo funciona',
    'support.officialNum':   'Número oficial de tu empresa',
    'support.officialCopy':  'Es el número que tus clientes ya conocen. MercaBot usa este número como base del atendimiento automatizado y de la activación asistida.',
    'support.notInformed':   'Aún no informado',
    'support.channelPrep':   'Canal en preparación',
    'support.channelHint':   'Ingresa el WhatsApp principal de la empresa para empezar. MercaBot conduce la activación y muestra solo lo que realmente necesita tu aprobación.',
    'support.informWA':      'Ingresar WhatsApp',

    'settings.title':        'Configuración',
    'settings.notifs':       '🔔 Notificaciones',
    'settings.notifDesktop': 'Notificaciones de escritorio',
    'settings.notifDesktopHint':'Alerta cuando una conversación necesita atención humana',
    'settings.notifEmail':   'Notificaciones por correo',
    'settings.notifEmailHint':'Resumen diario de conversaciones y leads',
    'settings.hours':        '🕐 Horario de atención',
    'settings.hoursCopy':    'El bot informa automáticamente cuando esté fuera del horario definido aquí.',
    'settings.hoursStart':   'Inicio',
    'settings.hoursEnd':     'Fin',
    'settings.hoursSave':    'Guardar horario',
    'settings.identity':     '🤖 Identidad del bot',
    'settings.botName':      'Nombre del agente virtual',
    'settings.botGreeting':  'Saludo inicial',
    'settings.identitySave': 'Guardar identidad',
    'settings.tour':         '🗺️ Tour y atajos',
    'settings.tourCopy':     'Repasa el tour de bienvenida en cualquier momento o consulta los atajos de teclado disponibles.',
    'settings.tourReplay':   '🗺️ Repetir tour',
    'settings.shortcuts':    '⌨️ Ver atajos',
    'settings.day.mon':      'Lun', 'settings.day.tue': 'Mar', 'settings.day.wed': 'Mié',
    'settings.day.thu':      'Jue', 'settings.day.fri': 'Vie', 'settings.day.sat': 'Sáb', 'settings.day.sun': 'Dom',

    'modal.upgrade.title':   'Elegir nuevo plan',
    'modal.upgrade.sub':     'Al confirmar, sigues a la contratación con el plan ya seleccionado. Si quieres revisar la cobranza antes, usa el centro digital de la cuenta.',
    'modal.upgrade.confirm': 'Confirmar cambio',
    'modal.request.title':   'Abrir ayuda con el contexto listo',
    'modal.request.sub':     'Explica en pocas líneas lo que necesitas resolver. MercaBot prepara el asunto y te lleva directo al flujo correcto de soporte.',
    'modal.request.subjectLabel':'Asunto',
    'modal.request.subjectPh':'Ej: El bot no está respondiendo',
    'modal.request.detailLabel':'Descripción',
    'modal.request.detailPh':'Describe lo que está pasando y lo que ya intentaste...',
    'modal.request.continue':'Continuar con ayuda guiada',
    'modal.channel.title':   'Registra el WhatsApp principal de tu empresa',
    'modal.channel.sub':     'En esta etapa solo necesitas ingresar el número que tu empresa va a usar en el atendimiento. MercaBot se encarga de la parte técnica y solo pide apoyo cuando sea realmente necesario.',
    'modal.channel.numLabel':'Número oficial de la empresa',
    'modal.channel.numHint': 'Ingresa el número que tus clientes ya usan para hablar contigo — formateamos automáticamente.',
    'modal.channel.metaConnect':'Conecta tu cuenta de Meta',
    'modal.channel.metaConnectCopy':'Haz clic en el botón — MercaBot busca el número y el token automáticamente. Toma menos de 1 minuto.',
    'modal.channel.metaWarn':'⚠️ Atención antes de conectar: al vincular, el WhatsApp en este número operará exclusivamente vía API — la app del celular dejará de recibir mensajes en ese número. Usa un número dedicado a la empresa, no personal.',
    'modal.channel.metaBtn': 'Conectar con WhatsApp Business',
    'modal.channel.manual':  'Prefiero ingresar los datos manualmente'
  };

  var EN = {
    'auth.title':            'Sign in to your operation',
    'auth.intro':             'Use the email of your MercaBot account. We will send a secure link so you can sign in and pick up where you left off.',
    'auth.note':              'This sign-in uses a secure email link. The panel unlocks only after authentication.',
    'auth.emailLabel':       'Email',
    'auth.emailPlaceholder': 'you@company.com',
    'auth.sendLink':         'Receive sign-in link',
    'auth.continueSession':  'Continue to panel',
    'auth.useOtherEmail':    'Use another email',

    'welcome.title':         'Account created!',
    'welcome.body':          'You now have everything you need to put AI answering your customers on WhatsApp. Just 3 steps — under 15 minutes.',
    'welcome.step1.html':    '<strong>Save your business</strong> WhatsApp number',
    'welcome.step2.html':    'Tell the bot how to <strong style="color:#eaf2eb">talk to your customers</strong>',
    'welcome.step3.html':    'Run the <strong style="color:#eaf2eb">first test</strong> — and the bot is live',
    'welcome.start':         'Get started →',
    'welcome.skip':          'See the panel first',

    'celebration.title':     'Bot live!',
    'celebration.body':      'Congrats! Your bot is configured and ready to answer customers on WhatsApp. Now just test it and publish.',
    'celebration.test':      'Run a test now →',
    'celebration.close':     'Close',

    'topbar.logout':         'Sign out',
    'topbar.alerts':         'Alerts',
    'topbar.alertsClear':    'Clear',
    'topbar.alertsEmpty':    'No alerts at the moment',
    'topbar.alertsGoto':     'Go to Inbox →',
    'topbar.greeting':       'Hello!',
    'topbar.planBadge':      'Plan',

    'tab.dashboard':         '📊 Dashboard',
    'tab.inbox':             '💬 Inbox',
    'tab.contacts':          '👥 Contacts',
    'tab.plan':              '💳 Plan',
    'tab.analytics':         '📈 Analytics',
    'tab.support':           'Support',
    'tab.settings':          '⚙️ Settings',

    'qs.eyebrow':            'Guided account activation',
    'qs.title':              'Your next step is here',
    'qs.intro':              'Just follow this order: save the business WhatsApp, fill in the operation, and run the first test. MercaBot handles the rest.',
    'qs.step.label':         'Step',
    'qs.state.now':          'Now',
    'qs.state.next':         'Later',
    'qs.state.done':         'Done',
    'qs.guide.prefix.html':  '<strong>Completed when:</strong>',
    'qs.s1.title':           'Save the business WhatsApp',
    'qs.s1.copy':            'Enter the main business number. After that, MercaBot continues the activation and only asks for input when authorization is truly required.',
    'qs.s1.guide':           'the main WhatsApp has been saved and activation can continue.',
    'qs.s2.title':           'Configure how the bot should respond',
    'qs.s2.copy':            'Tell the bot how to act, what to always do, and what to avoid. Save the opening line to make conversations feel natural.',
    'qs.s2.guide':           'the main instruction and the opening line are saved.',
    'qs.s3.title':           'Run the first test',
    'qs.s3.copy':            'Send a test message to your own WhatsApp and watch the AI reply. When it works, share with customers.',
    'qs.s3.guide':           'a real test ran and the AI replied as expected.',
    'qs.state.connected':    'Connected ✓',
    'qs.state.saved':        'Saved · Meta pending',
    'qs.state.ready':        'Ready',
    'qs.action.s1.do':       'Enter WhatsApp',
    'qs.action.s1.review':   'Review WhatsApp',
    'qs.action.s1.savedReview':'Review saved number',
    'qs.action.s2.do':       'Complete operation',
    'qs.action.s2.review':   'Review operation',
    'qs.action.s3':          'Run first test',
    'qs.progress.step1':     'Step 1 of 3: let\'s save the business WhatsApp.',
    'qs.progress.step1of3':  '1 of 3 steps complete. Step 2: configure the operation.',
    'qs.progress.step1pending':'1 of 3 — number saved (bot won\'t reply until Meta activates). Step 2: configure the operation.',
    'qs.progress.step2of3':  '2 of 3 steps complete. Step 3: run the first test.',
    'qs.progress.step3of3':  '3 of 3 — channel connected and AI live. Run the first test!',
    'qs.progress.step3pending':'3 of 3 — number saved, Meta activation in progress with the MercaBot team.',
    'inactivity.next.s1':    'Next: save the official number.',
    'inactivity.next.s2':    'Next: complete the operation base.',

    'banner.offline':        'You are offline — check your connection to sync the latest messages.',
    'banner.inactivity.title':'Your setup is incomplete',
    'banner.inactivity.body': '— almost there before the bot starts replying.',
    'banner.inactivity.cta':  'Continue now',
    'banner.dunning.cta':    'Update card →',
    'banner.planLimit.body.html': '<strong>You have used <span id="planLimitPct">80%</span> of this month\'s plan conversations.</strong> <span style="color:rgba(252,211,77,.75)">To avoid interrupting service, consider upgrading before you hit the limit.</span>',
    'banner.planLimit.cta':  'See plans →',

    'activation.label':      'Activation',
    'activation.step1':      '📱 Number',
    'activation.step2':      '⚙️ Operation',
    'activation.step3':      '✅ Test',

    'crumb.dashboard':       'Dashboard',

    'common.close':          'Close',
    'common.back':           'Back',
    'common.next':           'Next →',
    'common.save':           'Save',
    'common.cancel':         'Cancel',
    'common.loading':        'Loading…',

    'setup.pill':            'Recommended next action',
    'setup.title':           'Your activation is not complete yet',
    'setup.copy':            'Enter the main business WhatsApp, let MercaBot continue the activation and review the operation later.',
    'setup.checklist1':      'You only enter the main business WhatsApp number.',
    'setup.checklist2':      'MercaBot handles activation and notifies you when something needs your approval.',
    'setup.checklist3':      'After that, just fill in the operation and validate the first test.',
    'setup.action':          'Enter WhatsApp →',
    'setup.secondary':       'Understand activation',

    'plan.your':             'Your plan',
    'plan.change':           'Change plan',
    'plan.payment':          'Billing & subscription',
    'plan.next':             'Pick the next step',
    'plan.nextCopy':         'Open the account portal to manage payment or cancel the plan. If the portal is not yet available, MercaBot routes you to the right support flow.',
    'plan.manage':           'Manage payment',
    'plan.cancel':           'Cancel plan',

    'support.title':         'Help when you need it',
    'support.lead':          'Go straight to what you need',
    'support.leadCopy':      'Pick below the simplest path to continue with activation, billing, first test or account questions.',
    'support.guides':        'See quick guides',
    'support.guidesCopy':    'Open short guides for activation, billing, first test and service tweaks.',
    'support.center':        'Resolve at the digital center',
    'support.centerCopy':    'The digital center opens the right flow for activation, billing, tweaks or account questions.',
    'support.meta':          'Review Meta walkthrough',
    'support.metaCopy':      'Open the technical guide only if you want to follow the integration in detail.',
    'support.ticket':        'Describe what you need',
    'support.ticketCopy':    'Open the digital center with subject and description already filled in.',
    'support.demo':          'See an example',
    'support.demoCopy':      'Open a quick demo to see what the service should look like after activation.',
    'support.tour':          'Replay the panel tour',
    'support.tourCopy':      'Replay of the interactive guide step by step — useful to rediscover features you have not used yet.',
    'support.connections':   'Account connections',
    'support.aiPremium':     'MercaBot premium AI',
    'support.aiCopy':        'Premium AI is already part of the service. Your focus here is just connecting the business WhatsApp and reviewing the operation.',
    'support.aiInline':      'Premium AI included · ready in the backend',
    'support.aiHow':         'How it works',
    'support.officialNum':   'Your business official number',
    'support.officialCopy':  'This is the number your customers already know. MercaBot uses this number as the base for automated service and assisted activation.',
    'support.notInformed':   'Not entered yet',
    'support.channelPrep':   'Channel being prepared',
    'support.channelHint':   'Enter the main business WhatsApp to start. MercaBot drives activation and only asks when something truly needs your approval.',
    'support.informWA':      'Enter WhatsApp',

    'settings.title':        'Settings',
    'settings.notifs':       '🔔 Notifications',
    'settings.notifDesktop': 'Desktop notifications',
    'settings.notifDesktopHint':'Alert when a conversation needs human attention',
    'settings.notifEmail':   'Email notifications',
    'settings.notifEmailHint':'Daily summary of conversations and leads',
    'settings.hours':        '🕐 Service hours',
    'settings.hoursCopy':    'The bot automatically informs when you are outside the hours defined here.',
    'settings.hoursStart':   'Start',
    'settings.hoursEnd':     'End',
    'settings.hoursSave':    'Save hours',
    'settings.identity':     '🤖 Bot identity',
    'settings.botName':      'Virtual agent name',
    'settings.botGreeting':  'Opening greeting',
    'settings.identitySave': 'Save identity',
    'settings.tour':         '🗺️ Tour & shortcuts',
    'settings.tourCopy':     'Replay the welcome tour anytime or check available keyboard shortcuts.',
    'settings.tourReplay':   '🗺️ Replay tour',
    'settings.shortcuts':    '⌨️ See shortcuts',
    'settings.day.mon':      'Mon', 'settings.day.tue': 'Tue', 'settings.day.wed': 'Wed',
    'settings.day.thu':      'Thu', 'settings.day.fri': 'Fri', 'settings.day.sat': 'Sat', 'settings.day.sun': 'Sun',

    'modal.upgrade.title':   'Choose new plan',
    'modal.upgrade.sub':     'On confirm, you proceed to subscription with the selected plan. To review billing first, use the account digital center.',
    'modal.upgrade.confirm': 'Confirm change',
    'modal.request.title':   'Open help with context ready',
    'modal.request.sub':     'Explain in a few lines what you need to resolve. MercaBot prepares the subject and routes you straight to the right support flow.',
    'modal.request.subjectLabel':'Subject',
    'modal.request.subjectPh':'e.g. Bot is not replying',
    'modal.request.detailLabel':'Description',
    'modal.request.detailPh':'Describe what is happening and what you have tried...',
    'modal.request.continue':'Continue with guided help',
    'modal.channel.title':   'Register your business main WhatsApp',
    'modal.channel.sub':     'At this step you only need to enter the number your business will use for service. MercaBot handles the technical side and only asks for help when truly needed.',
    'modal.channel.numLabel':'Business official number',
    'modal.channel.numHint': 'Enter the number your customers already use to talk to you — we format it automatically.',
    'modal.channel.metaConnect':'Connect your Meta account',
    'modal.channel.metaConnectCopy':'Click the button — MercaBot fetches the number and token automatically. Takes under 1 minute.',
    'modal.channel.metaWarn':'⚠️ Heads up before connecting: once linked, WhatsApp on this number will operate exclusively via API — the phone app will stop receiving messages on this number. Use a business-dedicated number, not personal.',
    'modal.channel.metaBtn': 'Connect with WhatsApp Business',
    'modal.channel.manual':  'I prefer to enter data manually'
  };

  var BUNDLES = { pt: PT, es: ES, en: EN };

  // ── DETECÇÃO DE IDIOMA ────────────────────────────────────────────────────
  function detectLang() {
    try {
      var qp = new URLSearchParams(window.location.search).get('lang');
      if (qp) {
        qp = qp.toLowerCase();
        if (qp === 'es' || qp === 'en' || qp === 'pt') {
          try { localStorage.setItem('mb_panel_lang', qp); } catch (_) {}
          return qp;
        }
      }
    } catch (_) {}
    try {
      var stored = localStorage.getItem('mb_panel_lang');
      if (stored === 'es' || stored === 'en' || stored === 'pt') return stored;
    } catch (_) {}
    var nav = String(navigator.language || navigator.userLanguage || 'pt').toLowerCase();
    if (nav.indexOf('pt') === 0) return 'pt';
    if (nav.indexOf('es') === 0) return 'es';
    if (nav.indexOf('en') === 0) return 'en';
    return 'pt';
  }

  // ── APLICAÇÃO ─────────────────────────────────────────────────────────────
  function lookup(lang, key) {
    var bundle = BUNDLES[lang] || BUNDLES.pt;
    if (key in bundle) return bundle[key];
    // fallback PT se a chave existir lá
    if (lang !== 'pt' && key in BUNDLES.pt) return BUNDLES.pt[key];
    return null;
  }

  function applyLang(lang) {
    if (!lang) lang = detectLang();
    document.documentElement.setAttribute('data-mb-lang', lang);
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;

    // Title da página
    var titleByLang = {
      pt: 'Painel do Cliente — MercaBot',
      es: 'Panel del Cliente — MercaBot',
      en: 'Customer Panel — MercaBot'
    };
    if (titleByLang[lang]) document.title = titleByLang[lang];

    // Texto: data-i18n="key"
    var texts = document.querySelectorAll('[data-i18n]');
    texts.forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = lookup(lang, key);
      if (val !== null) el.textContent = val;
    });

    // HTML: data-i18n-html="key"
    var htmls = document.querySelectorAll('[data-i18n-html]');
    htmls.forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var val = lookup(lang, key);
      if (val !== null) el.innerHTML = val;
    });

    // Atributos: data-i18n-attr="placeholder=key,aria-label=key2"
    var attrs = document.querySelectorAll('[data-i18n-attr]');
    attrs.forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr') || '';
      spec.split(',').forEach(function (pair) {
        var parts = pair.split('=');
        if (parts.length !== 2) return;
        var attrName = parts[0].trim();
        var key = parts[1].trim();
        var val = lookup(lang, key);
        if (val !== null) el.setAttribute(attrName, val);
      });
    });
  }

  // Expõe como API global para outros scripts (app.js, setup-wizard.js)
  window.__mbI18n = {
    lang: detectLang(),
    t: function (key) { return lookup(this.lang, key) || key; },
    apply: applyLang,
    setLang: function (lang) {
      if (lang !== 'pt' && lang !== 'es' && lang !== 'en') return;
      this.lang = lang;
      try { localStorage.setItem('mb_panel_lang', lang); } catch (_) {}
      applyLang(lang);
    }
  };

  // Aplica imediatamente quando o DOM estiver pronto.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyLang(); });
  } else {
    applyLang();
  }
})();
